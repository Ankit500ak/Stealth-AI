const TypingSimulator = require('./type');
const ts = new TypingSimulator({ wpm: 90, batchMode: true, maxBatchSize: 12 });

ts.on('started', () => console.log('[TypingTest] started'));
ts.on('idle', () => console.log('[TypingTest] idle'));
ts.on('job-done', (job) => console.log('[TypingTest] job-done', job.meta));
ts.on('progress', (p) => console.log('[TypingTest] progress', p));

(async () => {
    const text = process.argv.slice(2).join(' ') || 'This is a quick typing test. It should type faster than average but remain natural.';
    console.log('[TypingTest] enqueueing text:', text);
    ts.enqueueText(text, 0, { source: 'test' });
})();
