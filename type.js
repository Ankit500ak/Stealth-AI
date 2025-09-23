const EventEmitter = require('events');
const { exec } = require('child_process');

class TypingSimulator extends EventEmitter {
    /**
     * Options:
     *  - wpm: target words-per-minute (affects pauses)
     *  - batchMode: if true, sends batches (faster)
     *  - defaultDelay: fallback ms delay between batches (if wpm not used)
     */
    constructor(options = {}) {
        super();
        this.queue = [];
        this.isRunning = false;
        this.isPaused = false;
        this.currentJob = null;

        // Speed controls
        this.wpm = options.wpm || 60; // default slightly faster than average
        this.batchMode = options.batchMode !== undefined ? options.batchMode : true;
        this.defaultDelay = options.defaultDelay !== undefined ? options.defaultDelay : 0;

        this.avgCharsPerWord = 5; // standard approximation
        this.maxBatchSize = options.maxBatchSize || 12; // max chars per batch
        this.minBatchSize = options.minBatchSize || 3;  // min chars per batch
    }

    setWpm(wpm) {
        this.wpm = Math.max(5, Number(wpm) || this.wpm);
    }

    setBatchMode(enabled) {
        this.batchMode = !!enabled;
    }

    enqueueText(text, delayMs = this.defaultDelay, meta = {}) {
        if (!text) return null;
        const job = { text: String(text), delayMs, meta };
        this.queue.push(job);
        this.emit('queued', job);
        this._ensureRunning();
        return job;
    }

    async typeClipboard(delayMs = this.defaultDelay) {
        // Hide all app windows before typing to ensure focus is on the target app
        try {
            const windowManager = require('./src/managers/window.manager');
            if (windowManager && typeof windowManager.hideAllWindows === 'function') {
                windowManager.hideAllWindows();
            }
        } catch (e) {}
        // Wait a bit for the target app to regain focus
        await new Promise((r) => setTimeout(r, 250));
        const { clipboard } = require('electron');
        const text = clipboard.readText();
        if (!text) return false;
        this.enqueueText(text, delayMs, { source: 'clipboard' });
        return true;
    }

    pause() {
        this.isPaused = true;
        this.emit('paused');
    }

    resume() {
        if (!this.isPaused) return;
        this.isPaused = false;
        this.emit('resumed');
        this._ensureRunning();
    }

    stop() {
        this.queue = [];
        this.isPaused = false;
        this.currentJob = null;
        this.emit('stopped');
    }

    async _ensureRunning() {
        if (this.isRunning || this.isPaused) return;
        this.isRunning = true;
        this.emit('started');

        while (this.queue.length && !this.isPaused) {
            const job = this.queue.shift();
            this.currentJob = job;
            try {
                await this._runJob(job);
                this.emit('job-done', job);
            } catch (e) {
                this.emit('job-error', { job, error: e });
            }
            this.currentJob = null;
        }

        this.isRunning = false;
        this.emit('idle');
    }

    async _runJob(job) {
        const str = job.text;
        const useBatch = (job.meta.batchMode !== undefined) ? job.meta.batchMode : this.batchMode;
        const wpm = job.meta.wpm || this.wpm;

        const timePerChar = (60000 / (wpm * this.avgCharsPerWord)); // ms per character based on WPM

        if (useBatch) {
            // Smart batching: group characters into batches of variable length
            let batch = '';
            const flushBatch = async (extraPause = 0) => {
                if (!batch) return;
                await this._sendBatch(batch);
                this.emit('progress', { job, token: batch });
                // Pause proportional to batch length to simulate typing speed, slightly faster than strict WPM
                const baseWait = timePerChar * batch.length * 0.85; // 0.85 = slightly faster
                const jitter = Math.random() * baseWait * 0.08; // small randomness
                await new Promise((r) => setTimeout(r, Math.max(0, baseWait + jitter + extraPause)));
                batch = '';
            };

            for (let i = 0; i < str.length; i++) {
                if (this.isPaused) break;
                const ch = str[i];

                // Always flush on newline/tab and send corresponding token
                if (ch === '\n') {
                    await flushBatch();
                    await this._sendBatch('{ENTER}');
                    await new Promise((r) => setTimeout(r, 80));
                    continue;
                }
                if (ch === '\t') {
                    await flushBatch();
                    await this._sendBatch('{TAB}');
                    await new Promise((r) => setTimeout(r, 40));
                    continue;
                }

                batch += ch;

                // If punctuation ends the batch, flush and apply extra pause
                if (/[\.\!\?\,;:]/.test(ch) || batch.length >= this.maxBatchSize) {
                    // If punctuation, include slightly longer pause
                    const extraPause = /[\.\!\?]/.test(ch) ? 260 : 0;
                    await flushBatch(extraPause);
                    // Softly reduce future batch size after punctuation for realism
                    continue;
                }

                // Randomly flush to create variability and mimic human typing patterns
                const shouldRandomFlush = batch.length >= this.minBatchSize && Math.random() < 0.12;
                if (shouldRandomFlush) {
                    await flushBatch();
                }
            }

            if (batch.length > 0) {
                await flushBatch();
            }
        } else {
            // Fallback: char-by-char typing (still uses WPM-based delays)
            for (let i = 0; i < str.length; i++) {
                if (this.isPaused) break;
                const ch = str[i];
                if (ch === '\n') {
                    await this._sendBatch('{ENTER}');
                } else if (ch === '\t') {
                    await this._sendBatch('{TAB}');
                } else {
                    await this._sendBatch(ch);
                }
                const baseWait = timePerChar * 0.85;
                const jitter = Math.random() * baseWait * 0.08;
                await new Promise((r) => setTimeout(r, Math.max(0, baseWait + jitter)));
                this.emit('progress', { job, index: i, char: ch });
            }
        }
    }

    _sendBatch(batch) {
        return new Promise((resolve) => {
            if (!batch) return resolve();

            // Map special tokens for SendKeys
            let payload = batch;
            if (payload === '{ENTER}' || payload === '{TAB}') {
                // leave as-is
            } else {
                // Escape braces so SendKeys treats them literally
                payload = payload.replace(/\{/g, "{{}").replace(/\}/g, "{}}");
            }

            // Escape single quotes for PowerShell string literal
            const esc = payload.replace(/'/g, "''");

            const psCmd = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${esc}');`;
            const command = `powershell -NoProfile -WindowStyle Hidden -Command "${psCmd.replace(/"/g, '\\"')}"`;

            exec(command, { shell: true, windowsHide: true, timeout: 20000 }, (err) => {
                if (err) {
                    // On error, log and resolve so typing continues
                    console.error('[TypingSimulator] _sendBatch error', { batch, error: err.message });
                }
                // small micro-delay to avoid overwhelming the shell
                setTimeout(resolve, 4);
            });
        });
    }
}

module.exports = TypingSimulator;
