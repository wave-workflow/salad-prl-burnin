#!/usr/bin/env bash
set -euo pipefail

wildrig="${WILDRIG_BIN:-/opt/wildrig/wildrig-multi}"
wallet="${PRL_WALLET:?PRL_WALLET is required}"
pool_url="${PRL_POOL_URL:-pool.pearlhash.xyz:9000}"
worker="${PRL_WORKER:-salad-${HOSTNAME:-worker}}"
algo="${PRL_ALGO:-pearlhash}"
burnin_seconds="${BURNIN_SECONDS:-1200}"
gpu_temp_limit="${GPU_TEMP_LIMIT:-81}"
print_time="${PRINT_TIME:-30}"

echo "[burnin] starting"
echo "[burnin] pool=${pool_url}"
echo "[burnin] worker=${worker}"
echo "[burnin] algo=${algo}"
echo "[burnin] burnin_seconds=${burnin_seconds}"
echo "[burnin] wildrig=$("$wildrig" --version 2>&1 | tr '\n' ' ')"

if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi || true
else
  echo "[burnin] nvidia-smi not found"
fi

cmd=(
  "$wildrig"
  --algo "$algo"
  --url "$pool_url"
  --user "${wallet}.${worker}"
  --pass x
  --opencl-platforms nvidia
  --opencl-devices 0
  --gpu-temp-limit "$gpu_temp_limit"
  --print-time "$print_time"
  --no-color
)

if [[ -n "${WILDRIG_EXTRA_ARGS:-}" ]]; then
  # shellcheck disable=SC2206
  extra_args=( $WILDRIG_EXTRA_ARGS )
  cmd+=("${extra_args[@]}")
fi

echo "[burnin] command=${cmd[*]/$wallet/<wallet>}"
timeout --foreground "$burnin_seconds" "${cmd[@]}"

