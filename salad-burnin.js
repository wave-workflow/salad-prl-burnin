#!/usr/bin/env node
"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const SALAD_API_BASE = "https://api.salad.com/api/public";
const DEFAULT_ENV_FILES = [
  "/home/openclaw/.openclaw/.env",
  "/home/openclaw/.openclaw/gateway.systemd.env",
  path.join(__dirname, ".env"),
];

const DEFAULT_TARGETS = [
  "RTX 5090 Laptop (24 GB)",
  "RTX 5090 (32 GB)",
  "RTX 4090 (24 GB)",
  "RTX 5080 (16 GB)",
  "RTX 5070 Ti (16 GB)",
  "RTX 4080 (16 GB)",
  "RTX 4070 Ti Super (16 GB)",
  "RTX 3060 Ti (8 GB)",
];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = raw.replace(/^['"]|['"]$/g, "");
  }
}

for (const filePath of DEFAULT_ENV_FILES) loadEnvFile(filePath);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente`);
  return value;
}

function saladHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "salad-prl-burnin/0.1.0",
    "Salad-Api-Key": requireEnv("SALAD_API_KEY"),
  };
}

function requestJson(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SALAD_API_BASE}${endpoint}`);
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        ...saladHeaders(),
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
      timeout: 20000,
    }, (res) => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { responseBody += chunk; });
      res.on("end", () => {
        let data = null;
        try {
          data = responseBody ? JSON.parse(responseBody) : null;
        } catch {
          data = { raw: responseBody };
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error(`Salad HTTP ${res.statusCode}`);
          error.statusCode = res.statusCode;
          error.payload = data;
          reject(error);
          return;
        }
        resolve(data);
      });
    });
    req.on("timeout", () => req.destroy(new Error("Timeout Salad API")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function miningOrg() {
  return encodeURIComponent(requireEnv("SALAD_MINING_ORGANIZATION_NAME"));
}

function miningProject() {
  return encodeURIComponent(requireEnv("SALAD_MINING_PROJECT_NAME"));
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\bnvidia\b|\bgeforce\b|\bgpu\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function pricesByPriority(gpuClass) {
  const prices = {};
  for (const item of gpuClass.prices || []) {
    prices[String(item.priority || "").toLowerCase()] = Number(item.price);
  }
  return prices;
}

async function listGpuClasses() {
  const payload = await requestJson("GET", `/organizations/${miningOrg()}/gpu-classes`);
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function getAvailability(gpuClassId) {
  return requestJson("POST", `/organizations/${miningOrg()}/availability/sce-gpu-availability`, {
    gpu_classes: [gpuClassId],
  });
}

function availabilityByPriority(payload) {
  return {
    batch: Number(payload?.available_gpu_batch || 0),
    low: Number(payload?.available_gpu_low || 0),
    medium: Number(payload?.available_gpu_medium || 0),
    high: Number(payload?.available_gpu_high || 0),
    on_call: Number(payload?.on_call_gpu || 0),
  };
}

async function findGpuClass(name) {
  const classes = await listGpuClasses();
  const normalized = normalizeName(name);
  const exact = classes.find((item) => normalizeName(item.name) === normalized);
  if (exact) return { ...exact, name: exact.name.trim() };

  const matches = classes.filter((item) => normalizeName(item.name).includes(normalized));
  if (matches.length === 1) return { ...matches[0], name: matches[0].name.trim() };
  if (matches.length > 1) {
    throw new Error(`GPU ambigua: ${name}. Matches: ${matches.map((item) => item.name).join(", ")}`);
  }
  throw new Error(`GPU nao encontrada na Salad: ${name}`);
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function displayName(value) {
  return String(value || "")
    .replace(/[^ ,-.0-9A-Za-z]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 63);
}

function buildPayload({ gpuClass, priority, minutes, image, workerSuffix }) {
  const seconds = Math.max(60, Math.round(Number(minutes) * 60));
  const safeGpu = slug(gpuClass.name.replace(/\(.+\)/g, ""));
  const name = `prl-burnin-${safeGpu}-${priority}`.slice(0, 63).replace(/-+$/g, "");
  const worker = `salad-${safeGpu}-${workerSuffix || Date.now().toString(36)}`.slice(0, 63);
  const wallet = requireEnv("SALAD_PRL_WALLET");

  return {
    autostart_policy: false,
    name,
    display_name: displayName(`PRL burn-in ${gpuClass.name}`),
    replicas: 1,
    restart_policy: "never",
    container: {
      image,
      image_caching: true,
      priority,
      command: ["/usr/local/bin/prl-burnin-entrypoint"],
      environment_variables: {
        PRL_WALLET: wallet,
        PRL_POOL_URL: process.env.SALAD_PRL_POOL_URL || "pool.pearlhash.xyz:9000",
        PRL_WORKER: worker,
        PRL_ALGO: "pearlhash",
        BURNIN_SECONDS: String(seconds),
        GPU_TEMP_LIMIT: process.env.SALAD_BURNIN_GPU_TEMP_LIMIT || "81",
        PRINT_TIME: "30",
      },
      resources: {
        cpu: Number(process.env.SALAD_BURNIN_CPU || 4),
        memory: Number(process.env.SALAD_BURNIN_MEMORY_MB || 8192),
        gpu_classes: [gpuClass.id],
        shm_size: Number(process.env.SALAD_BURNIN_SHM_MB || 1024),
        storage_amount: Number(process.env.SALAD_BURNIN_STORAGE_BYTES || 21474836480),
      },
    },
  };
}

function redactPayload(payload) {
  return JSON.parse(JSON.stringify(payload, (key, value) => {
    if (key === "PRL_WALLET") return "<wallet>";
    return value;
  }));
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function requireConfirmation(args, name) {
  if (!args.execute || args.confirm !== name) {
    throw new Error(`dry-run protegido. Para executar use: --execute --confirm ${name}`);
  }
}

async function cmdAvailability() {
  const classes = await listGpuClasses();
  const wanted = new Set(DEFAULT_TARGETS.map(normalizeName));
  const order = new Map(DEFAULT_TARGETS.map((name, index) => [normalizeName(name), index]));
  const rows = [];
  for (const gpuClass of classes) {
    if (!wanted.has(normalizeName(gpuClass.name))) continue;
    const availability = availabilityByPriority(await getAvailability(gpuClass.id));
    rows.push({
      name: gpuClass.name.trim(),
      id: gpuClass.id,
      prices: pricesByPriority(gpuClass),
      availability,
    });
  }
  rows.sort((a, b) => order.get(normalizeName(a.name)) - order.get(normalizeName(b.name)));
  printJson(rows);
}

async function cmdPlan(args) {
  const gpuName = args.gpu || "RTX 5090 Laptop (24 GB)";
  const priority = String(args.priority || "batch").toLowerCase();
  const minutes = Number(args.minutes || 20);
  const image = args.image || process.env.SALAD_BURNIN_IMAGE;
  if (!image) throw new Error("Informe --image ou SALAD_BURNIN_IMAGE antes de gerar deploy real");
  if (!["batch", "low", "medium", "high"].includes(priority)) throw new Error(`Prioridade invalida: ${priority}`);

  const gpuClass = await findGpuClass(gpuName);
  const availability = availabilityByPriority(await getAvailability(gpuClass.id));
  const payload = buildPayload({ gpuClass, priority, minutes, image, workerSuffix: args.workerSuffix });

  const plan = {
    dry_run: true,
    created_at: new Date().toISOString(),
    official_salad_endpoint: `/organizations/${process.env.SALAD_MINING_ORGANIZATION_NAME}/projects/${process.env.SALAD_MINING_PROJECT_NAME}/containers`,
    gpu_class: {
      name: gpuClass.name,
      id: gpuClass.id,
      prices: pricesByPriority(gpuClass),
      availability,
    },
    create_payload: payload,
    redacted_create_payload: redactPayload(payload),
    next_commands: [
      `node salad-burnin.js create --plan plans/${payload.name}.json --execute --confirm ${payload.name}`,
      `node salad-burnin.js start --name ${payload.name} --execute --confirm ${payload.name}`,
      `node salad-burnin.js stop --name ${payload.name} --execute --confirm ${payload.name}`,
      `node salad-burnin.js delete --name ${payload.name} --execute --confirm ${payload.name}`,
    ],
  };

  if (args.save) {
    const filePath = path.resolve(args.save === true ? path.join(__dirname, "plans", `${payload.name}.json`) : args.save);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(plan, null, 2)}\n`);
    console.error(`Plano salvo: ${filePath}`);
  }
  printJson({ ...plan, create_payload: plan.redacted_create_payload });
}

async function cmdCreate(args) {
  if (!args.plan) throw new Error("Informe --plan");
  const plan = JSON.parse(fs.readFileSync(args.plan, "utf8"));
  const payload = plan.create_payload;
  requireConfirmation(args, payload.name);
  const result = await requestJson("POST", `/organizations/${miningOrg()}/projects/${miningProject()}/containers`, payload);
  printJson(result);
}

async function cmdList() {
  const result = await requestJson("GET", `/organizations/${miningOrg()}/projects/${miningProject()}/containers`);
  printJson(result);
}

async function cmdGet(args) {
  const name = args.name;
  if (!name) throw new Error("Informe --name");
  const result = await requestJson("GET", `/organizations/${miningOrg()}/projects/${miningProject()}/containers/${encodeURIComponent(name)}`);
  printJson(result);
}

async function cmdInstances(args) {
  const name = args.name;
  if (!name) throw new Error("Informe --name");
  const result = await requestJson("GET", `/organizations/${miningOrg()}/projects/${miningProject()}/containers/${encodeURIComponent(name)}/instances`);
  printJson(result);
}

async function cmdAction(args, action) {
  const name = args.name;
  if (!name) throw new Error("Informe --name");
  requireConfirmation(args, name);
  const endpoint = `/organizations/${miningOrg()}/projects/${miningProject()}/containers/${encodeURIComponent(name)}${action === "delete" ? "" : `/${action}`}`;
  const result = await requestJson(action === "delete" ? "DELETE" : "POST", endpoint);
  printJson(result || { ok: true });
}

function usage() {
  console.log(`Uso:
  node salad-burnin.js availability
  node salad-burnin.js list
  node salad-burnin.js get --name prl-burnin-...
  node salad-burnin.js instances --name prl-burnin-...
  node salad-burnin.js plan --gpu "RTX 5090 Laptop (24 GB)" --priority batch --minutes 20 --image registry/image:tag --save
  node salad-burnin.js create --plan plans/prl-burnin-...json --execute --confirm prl-burnin-...
  node salad-burnin.js start|stop|delete --name prl-burnin-... --execute --confirm prl-burnin-...
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || command === "help") {
    usage();
    return;
  }
  if (command === "availability") return cmdAvailability();
  if (command === "list") return cmdList();
  if (command === "get") return cmdGet(args);
  if (command === "instances") return cmdInstances(args);
  if (command === "plan") return cmdPlan(args);
  if (command === "create") return cmdCreate(args);
  if (["start", "stop", "delete"].includes(command)) return cmdAction(args, command);
  throw new Error(`Comando desconhecido: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  if (error.payload) console.error(JSON.stringify(error.payload, null, 2));
  process.exit(1);
});
