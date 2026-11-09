import type { CDPSession } from '@playwright/test';

const CPU_SAMPLE_INTERVAL_US = 100;

async function readScriptSource(session: CDPSession, scriptId: string) {
  try {
    const { scriptSource } = await session.send('Debugger.getScriptSource', {
      scriptId,
    });
    return { scriptSource, sourceError: null };
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes(
        'Protocol error (Debugger.getScriptSource): No script for id:',
      )
    )
      throw error;
    return { scriptSource: null, sourceError: error.message };
  }
}

export async function observeStartupScripts(session: CDPSession) {
  const worlds = new Map<number, { name: string; origin: string }>();
  const scripts: {
    scriptId: string;
    url: string;
    hash: string;
    executionContextId: number;
  }[] = [];
  session.on('Runtime.executionContextCreated', ({ context }) => {
    worlds.set(context.id, { name: context.name, origin: context.origin });
  });
  session.on('Debugger.scriptParsed', (script) => scripts.push(script));
  await session.send('Runtime.enable');
  await session.send('Debugger.enable');
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', {
    interval: CPU_SAMPLE_INTERVAL_US,
  });
  return {
    async start() {
      scripts.length = 0;
      await session.send('Profiler.start');
    },
    async stop() {
      const { profile } = await session.send('Profiler.stop');
      const metadata = [];
      for (const script of scripts) {
        const { scriptSource, sourceError } = await readScriptSource(
          session,
          script.scriptId,
        );
        metadata.push({
          ...script,
          world: worlds.get(script.executionContextId),
          sourceError,
          isDeck: script.url.startsWith('chrome-extension://'),
          isPlaywrightInjected:
            scriptSource === null
              ? null
              : scriptSource.includes('InjectedScript') &&
                scriptSource.includes('createStacklessError'),
        });
      }
      return { profile, metadata };
    },
  };
}
