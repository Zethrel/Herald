// A logger the size of the problem: timestamped lines on stdout, one level
// knob. Anything that ships this to a service can replace the module.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = process.env.LOG_LEVEL ?? 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const emit = (name, stream) => (message) => {
    if (LEVELS[name] < threshold) return;
    stream.write(`${new Date().toISOString()} ${name.toUpperCase().padEnd(5)} ${message}\n`);
  };

  return {
    debug: emit('debug', process.stdout),
    info: emit('info', process.stdout),
    warn: emit('warn', process.stderr),
    error: emit('error', process.stderr),
  };
}
