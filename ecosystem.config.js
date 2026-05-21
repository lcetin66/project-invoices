module.exports = {
  apps: [
    {
      name: "rechnung-python-api",
      cwd: ".",
      script: "bash",
      args: "-lc 'source .venv/bin/activate && python api/classifier_api.py'",
      env: {
        CLASSIFIER_API_HOST: "127.0.0.1",
        CLASSIFIER_API_PORT: "8000"
      }
    },
    {
      name: "rechnung-next",
      cwd: "./nextjs-app",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
        PORT: "3000"
      }
    }
  ]
};
