// Dev-only streaming endpoint: re-runs the SERP ranking for ONE cluster and
// streams the Python script's progress (one JSON line per keyword) to the
// browser as Server-Sent Events. Only ChinaWebFoundry has a ranking script,
// and this relies on `prerender = false` running server-side under `astro dev`.
import type { APIRoute } from 'astro';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

export const prerender = false;

// Cluster ids look like "05-baidu-china-seo" — constrain to avoid passing
// arbitrary strings to the spawned process.
const CLUSTER_RE = /^[0-9]{2}-[a-z0-9-]+$/;

export const GET: APIRoute = ({ url }) => {
  const project = url.searchParams.get('project') ?? '';
  const cluster = url.searchParams.get('cluster') ?? '';

  if (project !== 'chinawebfoundry') {
    return new Response('Refresh is only available for ChinaWebFoundry.', { status: 400 });
  }
  if (!CLUSTER_RE.test(cluster)) {
    return new Response('Invalid cluster id.', { status: 400 });
  }

  const ROOT = join(process.cwd(), '..'); // repo root (Astro site lives in reporting-site/)
  const script = join(ROOT, 'seo', 'scripts', 'cwf_serp_ranking.py');
  const pythonCmd = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const sse = (data: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const py = spawn(pythonCmd, [script, '--cluster', cluster, '--stream'], {
        cwd: ROOT,
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      });

      // Forward each complete stdout line as one SSE message (the lines are JSON).
      let buf = '';
      py.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) sse(line);
        }
      });
      // stderr is diagnostic only — surface it as a log event, don't crash the stream.
      py.stderr.on('data', (chunk: Buffer) => {
        sse(JSON.stringify({ event: 'log', msg: chunk.toString('utf8').trimEnd() }));
      });
      py.on('error', err => {
        sse(JSON.stringify({ event: 'error', msg: `Failed to start Python: ${err.message}` }));
        if (!closed) { closed = true; controller.close(); }
      });
      py.on('close', code => {
        if (buf.trim()) sse(buf.trim());
        sse(JSON.stringify({ event: 'exit', code }));
        if (!closed) { closed = true; controller.close(); }
      });

      // If the browser disconnects (EventSource.close), kill the run so we don't
      // keep spending DataForSEO calls in the background.
      (this as any)._cleanup = () => { closed = true; py.kill(); };
    },
    cancel() {
      (this as any)._cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
};
