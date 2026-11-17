// PM2 reads environment values directly so URLs and credentials are never JS source.
const app = (name, script, env = {}, cwd = '/app') => ({
  name, script, cwd, instances: 1, exec_mode: 'fork', autorestart: true, watch: false,
  env: {NODE_ENV: 'production', ...env},
});

function port(name, fallback) {
  const value = process.env[name] || String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${name} must be a port between 1 and 65535`);
  }
  return Number(value);
}

const wikiPort = port('WIKI_PORT', 1000);
const nginxPort = port('NGINX_PORT', 80);
const ports = [nginxPort, 8080, 3000, 4000];
if (process.env.DISABLE_WIKI !== 'true') ports.push(wikiPort);
if (process.env.DISABLE_SMTP !== 'true') {
  ports.push(port('PORT_SECURE', 465), port('PORT_SUBMISSION', 587), 8888);
}
if (new Set(ports).size !== ports.length) throw new Error('Service ports must not overlap');

module.exports = {
  apps: [
    {...app('nginx', 'nginx'), args: '-g "daemon off;"'},
    app('api', '/app/apps/api/dist/app.js', {PORT: 8080}),
    app('worker', '/app/apps/api/dist/jobs/worker.js'),
    ...(process.env.DISABLE_SMTP === 'true' ? [] : [app('smtp', '/app/apps/smtp/dist/server.js', {
      PORT_SECURE: port('PORT_SECURE', 465), PORT_SUBMISSION: port('PORT_SUBMISSION', 587),
      CERT_PATH: '/certs', ACME_JSON_PATH: '/certs/acme.json',
    })]),
    app('web', 'apps/web/server.js', {PORT: 3000, HOSTNAME: '0.0.0.0'}, '/app/apps/web/.next/standalone'),
    app('landing', 'apps/landing/server.js', {PORT: 4000, HOSTNAME: '0.0.0.0'}, '/app/apps/landing/.next/standalone'),
    ...(process.env.DISABLE_WIKI === 'true' ? [] : [
      app('wiki', 'apps/wiki/server.js', {PORT: wikiPort, HOSTNAME: '0.0.0.0'}, '/app/apps/wiki/.next/standalone'),
    ]),
  ],
};
