import { createConnection } from "node:net";

const requiredPorts = [
  { name: "frontend", host: "127.0.0.1", port: 3000 },
  { name: "backend", host: "127.0.0.1", port: 3001 },
];

function checkPort({ host, port }) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.unref();
    socket.setTimeout(750);
    socket.once("connect", () => finish({ free: false }));
    socket.once("timeout", () => finish({ free: false }));
    socket.once("error", (error) => {
      finish({ free: error.code === "ECONNREFUSED", error });
    });
  });
}

const results = await Promise.all(
  requiredPorts.map(async (service) => ({
    ...service,
    ...(await checkPort(service)),
  })),
);

const occupied = results.filter((result) => !result.free);

if (occupied.length > 0) {
  console.error("\nDevelopment servers were not started because required ports are busy:\n");

  for (const service of occupied) {
    const protocol = service.name === "frontend" ? "https" : "http";
    console.error(`  - ${service.name}: ${protocol}://${service.host}:${service.port}`);
  }

  console.error("\nOn Windows, identify the process with:");
  console.error("  netstat -ano | findstr :3000");
  console.error("  netstat -ano | findstr :3001");
  console.error("\nThen stop only the confirmed development process:");
  console.error('  powershell.exe -Command "Stop-Process -Id <PID> -Force"\n');
  process.exit(1);
}

console.log("[dev:check] ports 3000 and 3001 are available");
