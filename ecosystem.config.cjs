module.exports = {
  apps: [
    {
      name: "thagencia-backend",
      script: "backend/dist/server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3001",
      },
    },
    {
      name: "thagencia-frontend",
      script: "npm",
      args: "run start --workspace frontend",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: "3010",
      },
    },
    {
      name: "thagencia-webhook-worker",
      script: "backend/dist/webhook-worker.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
