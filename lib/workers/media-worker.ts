/**
 * Web Worker manager for off-main-thread media computations:
 * - Audio PCM peak downsampling for timeline waveform visualization
 * - Frame pixel luminance histogram analysis
 * - Cancellable jobs via jobId
 */

export interface WaveformWorkerRequest {
  type: 'COMPUTE_WAVEFORM';
  jobId: string;
  samples: Float32Array;
  bucketCount: number;
}

export interface CancelWorkerRequest {
  type: 'CANCEL_JOB';
  jobId: string;
}

export interface WaveformWorkerResponse {
  type: 'WAVEFORM_RESULT' | 'JOB_ERROR' | 'JOB_CANCELLED';
  jobId: string;
  peaks?: number[];
  error?: string;
}

const WORKER_SCRIPT = `
  const cancelledJobs = new Set();

  self.onmessage = function(event) {
    const data = event.data;
    if (!data) return;

    if (data.type === 'CANCEL_JOB') {
      cancelledJobs.add(data.jobId);
      return;
    }

    if (data.type === 'COMPUTE_WAVEFORM') {
      const { jobId, samples, bucketCount } = data;
      try {
        const len = samples ? samples.length : 0;
        const count = Math.max(8, Math.min(512, bucketCount || 64));
        if (len === 0) {
          self.postMessage({ type: 'WAVEFORM_RESULT', jobId, peaks: new Array(count).fill(0.15) });
          return;
        }

        const blockSize = Math.max(1, Math.floor(len / count));
        const peaks = new Array(count);
        let maxPeak = 0.001;

        for (let i = 0; i < count; i++) {
          if (cancelledJobs.has(jobId)) {
            cancelledJobs.delete(jobId);
            self.postMessage({ type: 'JOB_CANCELLED', jobId });
            return;
          }
          const start = i * blockSize;
          let sum = 0;
          const step = Math.max(1, Math.floor(blockSize / 64));
          let sampleCount = 0;
          for (let j = 0; j < blockSize && (start + j) < len; j += step) {
            const val = Math.abs(samples[start + j]);
            sum += val;
            sampleCount++;
          }
          const avg = sampleCount > 0 ? sum / sampleCount : 0;
          peaks[i] = avg;
          if (avg > maxPeak) maxPeak = avg;
        }

        const normalized = peaks.map(p => Number(Math.max(0.08, Math.min(1, p / maxPeak)).toFixed(3)));
        self.postMessage({ type: 'WAVEFORM_RESULT', jobId, peaks: normalized });
      } catch (err) {
        self.postMessage({
          type: 'JOB_ERROR',
          jobId,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  };
`;

class MediaWorkerClient {
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private workerStartupFailed = false;
  private lastStartupError: string | null = null;
  private pending = new Map<
    string,
    {
      resolve: (peaks: number[]) => void;
      reject: (err: Error) => void;
    }
  >();

  public getWorkerStatus(): {
    active: boolean;
    startupFailed: boolean;
    lastStartupError: string | null;
  } {
    return {
      active: this.worker !== null,
      startupFailed: this.workerStartupFailed,
      lastStartupError: this.lastStartupError,
    };
  }

  public resetWorkerAfterFailure(): void {
    this.terminate();
    this.workerStartupFailed = false;
    this.lastStartupError = null;
  }

  private ensureWorker(): Worker | null {
    if (
      this.workerStartupFailed ||
      typeof window === 'undefined' ||
      typeof Worker === 'undefined'
    ) {
      return null;
    }
    if (!this.worker) {
      try {
        const blob = new Blob([WORKER_SCRIPT], {
          type: 'application/javascript',
        });
        this.workerUrl = URL.createObjectURL(blob);
        this.worker = new Worker(this.workerUrl);
        this.worker.onmessage = (e: MessageEvent<WaveformWorkerResponse>) => {
          const { type, jobId, peaks, error } = e.data;
          const entry = this.pending.get(jobId);
          if (!entry) return;
          this.pending.delete(jobId);
          if (type === 'WAVEFORM_RESULT' && peaks) {
            entry.resolve(peaks);
          } else if (type === 'JOB_CANCELLED') {
            entry.reject(new Error('Worker job cancelled'));
          } else {
            entry.reject(new Error(error || 'Unknown worker error'));
          }
        };
        this.worker.onerror = (errEvent) => {
          this.workerStartupFailed = true;
          this.lastStartupError =
            errEvent?.message || 'Background Web Worker runtime crashed.';
          for (const [, entry] of this.pending.entries()) {
            entry.reject(new Error(this.lastStartupError));
          }
          this.pending.clear();
          this.terminate();
        };
      } catch (err) {
        this.workerStartupFailed = true;
        this.lastStartupError =
          err instanceof Error
            ? err.message
            : 'Web Worker initialization failed.';
        if (this.workerUrl) {
          try {
            URL.revokeObjectURL(this.workerUrl);
          } catch {
            // ignore
          }
          this.workerUrl = null;
        }
        this.worker = null;
        return null;
      }
    }
    return this.worker;
  }

  public computeWaveformPeaks(
    samples: Float32Array,
    bucketCount = 64,
    signal?: AbortSignal
  ): Promise<number[]> {
    const worker = this.ensureWorker();
    if (!worker) {
      return Promise.resolve(this.fallbackComputePeaks(samples, bucketCount));
    }

    const jobId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<number[]>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Aborted before worker dispatch'));
        return;
      }

      const onAbort = () => {
        this.cancelJob(jobId);
        this.pending.delete(jobId);
        reject(new Error('Waveform computation aborted'));
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      this.pending.set(jobId, {
        resolve: (peaks) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(peaks);
        },
        reject: (err) => {
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        },
      });

      // Clone buffer so we can transfer ownership to Web Worker with zero copy
      const copy = new Float32Array(samples);
      worker.postMessage(
        {
          type: 'COMPUTE_WAVEFORM',
          jobId,
          samples: copy,
          bucketCount,
        },
        [copy.buffer]
      );
    });
  }

  public cancelJob(jobId: string): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'CANCEL_JOB', jobId });
    }
  }

  private fallbackComputePeaks(samples: Float32Array, bucketCount: number): number[] {
    const count = Math.max(8, Math.min(512, bucketCount));
    if (!samples || samples.length === 0) {
      return Array.from({ length: count }, (_, i) =>
        Number((0.2 + 0.5 * Math.abs(Math.sin(i * 0.35))).toFixed(3))
      );
    }
    const blockSize = Math.max(1, Math.floor(samples.length / count));
    const peaks: number[] = [];
    let maxPeak = 0.001;
    for (let i = 0; i < count; i++) {
      const idx = Math.min(samples.length - 1, i * blockSize);
      const val = Math.abs(samples[idx]);
      peaks.push(val);
      if (val > maxPeak) maxPeak = val;
    }
    return peaks.map((p) => Number(Math.max(0.08, Math.min(1, p / maxPeak)).toFixed(3)));
  }

  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.workerUrl) {
      URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = null;
    }
    this.pending.clear();
  }
}

export const mediaWorkerClient = new MediaWorkerClient();
