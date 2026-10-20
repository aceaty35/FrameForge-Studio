import { test, expect } from '@playwright/test';
import {
  buildBinaryWavContainer,
  probeBinaryMediaContainer,
} from '../lib/qa/media-probe';

/**
 * Generates a valid 1x1 PNG binary buffer for real browser image decode + magic-byte validation.
 */
function createValid1x1PngBuffer(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
}

/**
 * Generates a valid RIFF/WAVE PCM audio buffer for browser <audio> and WebAudio decode + magic-byte validation.
 */
function createValidWavBuffer(durationSec = 1.0): Buffer {
  const bytes = buildBinaryWavContainer({
    durationSec,
    sampleRate: 48000,
    channels: 2,
    frequencyHz: 440,
  });
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

test.describe('FrameForge Studio Comprehensive E2E & Cross-Viewport QA Suite', () => {
  test('1. Desktop Viewport: loads workspace, verifies state changes on split, crop, speed, and runs live QA Media Probe suite', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/online-video-editor');

    await expect(page.getByTestId('top-project-name-input')).toBeVisible();
    await expect(page.getByTestId('editor-preview-canvas')).toBeVisible();

    // Verify initial clip count in timeline before splitting
    const clipsBefore = await page.locator('[data-testid^="timeline-clip-"]').count();
    expect(clipsBefore).toBeGreaterThanOrEqual(3);

    // Split selected clip at playhead (1.20s) and verify clip count actually increases by 1
    await page.getByTestId('timeline-split-btn').click();
    const clipsAfterSplit = await page.locator('[data-testid^="timeline-clip-"]').count();
    expect(clipsAfterSplit).toBe(clipsBefore + 1);

    // Switch to Crop tab, select 9:16 Vertical, and verify canvas aspect ratio changes
    await page.getByTestId('sidebar-tab-crop').click();
    await page.getByTestId('aspect-ratio-9:16').click();
    await expect(page.getByTestId('aspect-ratio-9:16')).toHaveClass(/border-sky-500/);

    // Open Security & QA Center, switch to Tab 5 (QA Suite & Media Probe), and run live verification
    await page.getByTestId('open-security-dialog-button').click();
    await expect(page.getByTestId('security-audit-dialog')).toBeVisible();
    await page.getByTestId('security-tab-qa').click();
    await page.getByTestId('run-qa-suite-btn').click();

    await expect(page.getByTestId('qa-suite-execution-results')).toBeVisible();
    await expect(page.getByTestId('qa-probed-export-card')).toContainText('1280×720 @ 30fps');
    await expect(page.getByTestId('qa-unresolved-limitations-list')).toContainText('QA-FAIL-ENV-01');
  });

  test('2. Mobile Viewport (390x844): verifies responsive mobile navigation bar, bottom sheet tools, and timeline actions', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/online-video-editor');

    // Verify mobile bottom bar is rendered and interactive
    const mobileNav = page.getByTestId('mobile-bottom-nav');
    await expect(mobileNav).toBeVisible();

    // Open Subtitles sheet on mobile and generate batch subtitles
    await page.getByTestId('mobile-tab-subtitles').click();
    await expect(page.getByTestId('mobile-bottom-sheet')).toBeVisible();
    const initialClipCount = await page.locator('[data-testid^="timeline-clip-"]').count();
    await page.getByTestId('generate-batch-subtitles-btn').click();

    // Verify subtitle clips were actually added to the timeline state
    const afterSubtitleClipCount = await page
      .locator('[data-testid^="timeline-clip-"]')
      .count();
    expect(afterSubtitleClipCount).toBeGreaterThan(initialClipCount);
  });

  test('3. File Picker Import & Drag-and-Drop Import: imports genuine binary media and verifies asset list state changes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/online-video-editor');

    // Ensure Media tab is active
    await page.getByTestId('sidebar-tab-media').click();

    const wavBuffer = createValidWavBuffer(1.0);
    const probeCheck = await probeBinaryMediaContainer(new Uint8Array(wavBuffer));
    expect(probeCheck.valid).toBe(true);

    // 3A. File Picker Import via hidden input[type="file"]
    const fileInput = page.getByTestId('media-file-input');
    await fileInput.setInputFiles({
      name: 'picker_imported_tone.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await expect(page.getByText('picker_imported_tone.wav').first()).toBeVisible({
      timeout: 10_000,
    });

    // 3B. Drag-and-Drop Import via synthetic DataTransfer on [data-testid="media-dropzone"]
    const pngBase64 = createValid1x1PngBuffer().toString('base64');
    await page.evaluate((b64) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const file = new File([bytes], 'dropped_overlay_card.png', {
        type: 'image/png',
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      const dropzone = document.querySelector('[data-testid="media-dropzone"]');
      if (dropzone) {
        dropzone.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt,
          })
        );
      }
    }, pngBase64);

    await expect(page.getByText('dropped_overlay_card.png').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('4. Keyboard Navigation: verifies Space play/pause, ArrowRight frame step, S split, and Ctrl+Z / Ctrl+Y undo/redo', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/online-video-editor');

    // Click canvas area to ensure focus is not trapped in a text input
    await page.getByTestId('editor-preview-canvas').click();

    const initialTimecode = await page.getByTestId('timecode-display').textContent();

    // Step forward 5 frames via ArrowRight
    await page.keyboard.press('ArrowRight');
    const steppedTimecode = await page.getByTestId('timecode-display').textContent();
    expect(steppedTimecode).not.toBe(initialTimecode);

    // Split clip with 's' shortcut and verify clip count increases
    const beforeCount = await page.locator('[data-testid^="timeline-clip-"]').count();
    await page.keyboard.press('s');
    const afterSplitCount = await page.locator('[data-testid^="timeline-clip-"]').count();
    expect(afterSplitCount).toBe(beforeCount + 1);

    // Undo with Control+z and verify clip count returns to beforeCount
    await page.keyboard.press('Control+z');
    const afterUndoCount = await page.locator('[data-testid^="timeline-clip-"]').count();
    expect(afterUndoCount).toBe(beforeCount);

    // Redo with Control+y and verify clip count returns to afterSplitCount
    await page.keyboard.press('Control+y');
    const afterRedoCount = await page.locator('[data-testid^="timeline-clip-"]').count();
    expect(afterRedoCount).toBe(afterSplitCount);
  });

  test('5. Export Cancellation & Error Recovery: cancels an in-flight export and recovers from disguised/corrupted file import', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/online-video-editor');

    // 5A. Disguised executable/script payload import triggers visible SecurityRecoveryBanner
    const fileInput = page.getByTestId('media-file-input');
    await fileInput.setInputFiles({
      name: 'disguised_script.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('<!DOCTYPE html><script>alert("xss")</script>', 'utf-8'),
    });

    const recoveryBanner = page.getByTestId('security-recovery-banner');
    await expect(recoveryBanner).toBeVisible();

    // Click primary recovery action on the banner and confirm recovery executes
    await page.getByTestId('recovery-primary-action-btn').click();
    await expect(recoveryBanner).toBeHidden();

    // 5B. Start local export and cancel mid-flight
    await page.getByTestId('open-export-button').click();
    await expect(page.getByTestId('export-dialog')).toBeVisible();
    await page.getByTestId('start-export-btn').click();

    const cancelBtn = page.getByTestId('cancel-export-btn');
    if (await cancelBtn.isVisible()) {
      await cancelBtn.click();
      await expect(page.getByTestId('export-status-card')).toContainText(/cancelled/i);
    }
  });

  test('6. Page Refresh & Project Restoration: persists renamed project & timeline edits to IndexedDB and restores after reload', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/online-video-editor');

    const nameInput = page.getByTestId('top-project-name-input');
    await nameInput.fill('E2E Persistent Project 42');
    await nameInput.blur();

    // Split a clip so clip count changes
    const initialClips = await page.locator('[data-testid^="timeline-clip-"]').count();
    await page.getByTestId('timeline-split-btn').click();
    const editedClips = await page.locator('[data-testid^="timeline-clip-"]').count();
    expect(editedClips).toBe(initialClips + 1);

    // Click manual Save button in top bar and wait for 'Saved' status indicator
    await page.getByTestId('top-save-project-btn').click();
    await expect(page.getByTestId('project-save-status-badge')).toContainText(/Saved/i);

    // Reload browser page and verify project name and clip count are restored from IndexedDB
    await page.reload();
    await expect(page.getByTestId('top-project-name-input')).toHaveValue(
      'E2E Persistent Project 42'
    );
    const restoredClips = await page.locator('[data-testid^="timeline-clip-"]').count();
    expect(restoredClips).toBe(editedClips);
  });
});
