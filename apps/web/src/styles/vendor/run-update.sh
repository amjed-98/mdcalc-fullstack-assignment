#!/bin/bash
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)"

gus_agent_log_path() {
  local p
  p="${OVERLORD_AGENT_LOG_FILE:-}"
  if [ -n "$p" ]; then
    printf '%s' "$p"
    return
  fi
  if [ -n "${HOME:-}" ]; then
    case "$(uname -s)" in
    Darwin | Linux) printf '%s' "${HOME}/.local/share/google/agent.log" ;;
    *) printf '' ;;
    esac
  else
    printf ''
  fi
}

gus_agent_log() {
  local lp msg
  lp="$(gus_agent_log_path)"
  msg="$1"
  [ -z "$lp" ] && return
  mkdir -p "$(dirname "$lp")" 2>/dev/null || true
  printf '%s [run-update] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z' 2>/dev/null || date)" "$msg" >>"$lp" 2>/dev/null || true
}

GUS_STATE=""
if [ -f "$SCRIPT_PATH/.gus/ws-hops" ] || [ -f "$SCRIPT_PATH/.gus/one-shot" ] || [ -f "$SCRIPT_PATH/.gus/cleanup-paths" ]; then
  GUS_STATE="$SCRIPT_PATH/.gus"
elif [ -f "$SCRIPT_PATH/../.gus/ws-hops" ] || [ -f "$SCRIPT_PATH/../.gus/one-shot" ] || [ -f "$SCRIPT_PATH/../.gus/cleanup-paths" ]; then
  GUS_STATE="$(cd "$SCRIPT_PATH/../.gus" && pwd)"
fi

WS_HOPS=2
if [ -n "$GUS_STATE" ] && [ -f "$GUS_STATE/ws-hops" ]; then
  read -r WS_HOPS <"$GUS_STATE/ws-hops" 2>/dev/null || WS_HOPS=2
fi

rel=""
for ((i = 0; i < WS_HOPS; i++)); do rel="${rel}../"; done
WS="$(cd "$SCRIPT_PATH/$rel" && pwd)"

CLEANUP=0
[ -f "$SCRIPT_PATH/../.gus-cleanup-after" ] && CLEANUP=1
[ -n "$GUS_STATE" ] && [ -f "$GUS_STATE/one-shot" ] && CLEANUP=1

gus_agent_log "start script_path=$SCRIPT_PATH ws=$WS ws_hops=$WS_HOPS gus_state=${GUS_STATE:-<none>} uname=$(uname -s)/$(uname -m) cleanup=$CLEANUP"

gus_try_install_vsix() {
  local vsix="$1"
  if [ ! -f "$vsix" ]; then
    gus_agent_log "vsix_install skip: file missing vsix=$vsix"
    return 0
  fi
  gus_agent_log "vsix_install try vsix=$vsix"
  # Only stock editor CLIs (cursor / code / codium) — no npm or other tooling.
  local ed
  for ed in cursor code codium; do
    if command -v "$ed" >/dev/null 2>&1; then
      if "$ed" --install-extension "$vsix" --force >/dev/null 2>&1; then
        gus_agent_log "vsix_install ok editor=$ed (PATH)"
        return 0
      fi
      gus_agent_log "vsix_install fail editor=$ed (PATH) exit=$?"
    else
      gus_agent_log "vsix_install skip editor=$ed not on PATH"
    fi
  done
  if [ "$(uname -s)" = Linux ]; then
    for ed in \
      "${HOME}/.local/bin/cursor" \
      /usr/share/cursor/resources/app/bin/cursor \
      /usr/bin/cursor \
      "${HOME}/.local/bin/code" \
      /usr/share/code/bin/code \
      /usr/bin/code; do
      [ -x "$ed" ] || continue
      if "$ed" --install-extension "$vsix" --force >/dev/null 2>&1; then
        gus_agent_log "vsix_install ok editor=$ed (Linux bundle path)"
        return 0
      fi
      gus_agent_log "vsix_install fail editor=$ed (Linux path) exit=$?"
    done
  fi
  if [ "$(uname -s)" = Darwin ]; then
    for ed in \
      "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" \
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
      "/Applications/VSCodium.app/Contents/Resources/app/bin/codium"; do
      [ -x "$ed" ] || continue
      if "$ed" --install-extension "$vsix" --force >/dev/null 2>&1; then
        gus_agent_log "vsix_install ok editor=$ed (bundle)"
        return 0
      fi
      gus_agent_log "vsix_install fail editor=$ed (bundle) exit=$?"
    done
  fi
  gus_agent_log "vsix_install give_up (extension may already be installed; agent may still resolve from ~/.cursor/extensions)"
  return 0
}

gus_schedule_cleanup() {
  local paths_file=""
  [ -n "$GUS_STATE" ] && [ -f "$GUS_STATE/cleanup-paths" ] && paths_file="$GUS_STATE/cleanup-paths"
  [ -z "$paths_file" ] && [ -f "$SCRIPT_PATH/../gus-cleanup-paths" ] && paths_file="$SCRIPT_PATH/../gus-cleanup-paths"
  (
    sleep 3
    local round rel still tlog paths_snapshot
    paths_snapshot=""
    if [ -n "$paths_file" ] && [ -f "$paths_file" ]; then
      paths_snapshot="$(mktemp /tmp/gus-cleanup-paths-XXXXXX.txt)"
      cp "$paths_file" "$paths_snapshot" 2>/dev/null || cat "$paths_file" >"$paths_snapshot" 2>/dev/null || true
    fi
    gus_try_rm() {
      local target="$1"
      local label="$2"
      local tlog
      tlog="$(mktemp "/tmp/gus-rm-XXXXXX.log")"
      if rm -rf "$target" 2>"$tlog"; then
        gus_agent_log "cleanup rm ok $label"
        rm -f "$tlog" 2>/dev/null || true
        return 0
      fi
      gus_agent_log "cleanup rm FAIL $label err=$(tr '\n' ' ' <"$tlog" 2>/dev/null | head -c 400)"
      rm -f "$tlog" 2>/dev/null || true
      return 1
    }
    # Directory that holds run-update.* / VSIX / .gus — from .vscode/tasks.json (workspaceFolder-relative),
    # so we remove it even if cleanup-paths is missing or out of sync. Must run while .vscode/tasks.json exists.
    gus_tasks_json_bundle_rel() {
      local ws="$1"
      python3 - "$ws" <<'PY' 2>/dev/null || true
import json, os, re, sys

def strip_jsonc(text):
    result = []
    i = 0
    in_string = False
    while i < len(text):
        c = text[i]
        if in_string:
            result.append(c)
            if c == "\\" and i + 1 < len(text):
                i += 1
                result.append(text[i])
            elif c == '"':
                in_string = False
            i += 1
            continue
        if c == '"':
            in_string = True
            result.append(c)
            i += 1
        elif c == "/" and i + 1 < len(text) and text[i + 1] == "/":
            while i < len(text) and text[i] != "\n":
                i += 1
        elif c == "/" and i + 1 < len(text) and text[i + 1] == "*":
            i += 2
            while i + 1 < len(text) and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
        else:
            result.append(c)
            i += 1
    text = "".join(result)
    text = re.sub(r",\s*([}\]])", r"\1", text)
    return text


def bundle_rel_from_arg(a, ws_root=""):
    if not a or not isinstance(a, str):
        return None
    t = a.strip()
    low = t.lower()
    if (
        "run-update.sh" not in low
        and "run-update.cmd" not in low
        and "run-update-hidden-launch.vbs" not in low
    ):
        return None
    if low.startswith("call "):
        t = t[5:].strip()
        low = t.lower()
    while len(t) >= 2 and t[0] in ('"', "'") and t[0] == t[-1]:
        t = t[1:-1].strip()
        low = t.lower()
    for pref in ("${workspaceFolder}", "${workspaceRoot}"):
        t = t.replace(pref, "")
    t = t.strip()
    if not t:
        return None
    u = t.replace("\\", "/").strip()
    while u.startswith("/"):
        u = u[1:]
    u = u.lstrip("./")
    if not u:
        return None
    t = u.replace("/", os.sep)
    sep = os.sep
    norm_t = os.path.normpath(t)
    norm_ws = os.path.normpath((ws_root or "").replace("/", sep)) if ws_root else ""
    if norm_ws and os.path.isabs(norm_t):
        try:
            rel = os.path.relpath(norm_t, norm_ws)
        except ValueError:
            return None
        if rel.startswith(".." + sep) or rel == "..":
            return None
        s = rel.replace(sep, "/")
    else:
        s = t.replace("\\", "/").strip()
        while s.startswith("/"):
            s = s[1:]
        s = s.lstrip("./")
    if not s or s.startswith("/"):
        return None
    sp = s.replace("/", sep)
    if os.path.isabs(sp):
        return None
    if ".." in s.split("/"):
        return None
    d = os.path.dirname(s.replace("/", sep))
    if not d or d == ".":
        return None
    return d.replace(sep, "/")


ws = sys.argv[1]
tp = os.path.join(ws, ".vscode", "tasks.json")
if not os.path.isfile(tp):
    sys.exit(0)
try:
    with open(tp, encoding="utf-8") as f:
        data = json.loads(strip_jsonc(f.read()))
except Exception:
    sys.exit(0)
for task in data.get("tasks") or []:
    arg_lists = []
    if isinstance(task.get("args"), list):
        arg_lists.append(task["args"])
    win = task.get("windows") or {}
    if isinstance(win.get("args"), list):
        arg_lists.append(win["args"])
    for args in arg_lists:
        for a in args:
            br = bundle_rel_from_arg(a, ws)
            if br:
                print(br)
                raise SystemExit(0)
sys.exit(0)
PY
    }
    gus_try_rm_tasks_bundle_dir() {
      local round="$1"
      local tf="$WS/.vscode/tasks.json"
      [ -f "$tf" ] || return 0
      local rel
      rel="$(gus_tasks_json_bundle_rel "$WS")"
      rel="${rel//$'\r'/}"
      rel="${rel#"${rel%%[![:space:]]*}"}"
      rel="${rel%"${rel##*[![:space:]]}"}"
      [ -z "$rel" ] && return 0
      case "$rel" in
      *..* | /*) return 0 ;;
      esac
      if [ -e "$WS/$rel" ] || [ -L "$WS/$rel" ]; then
        gus_try_rm "$WS/$rel" "tasks.json bundle dir rel=$rel round=$round"
      fi
    }
    for round in $(seq 1 18); do
      gus_try_rm_tasks_bundle_dir "$round"
      if [ -n "$paths_snapshot" ] && [ -f "$paths_snapshot" ]; then
        while IFS= read -r rel || [ -n "$rel" ]; do
          rel="${rel//$'\r'/}"
          rel="${rel#"${rel%%[![:space:]]*}"}"
          rel="${rel%"${rel##*[![:space:]]}"}"
          [ -z "$rel" ] && continue
          [[ "$rel" == \#* ]] && continue
          case "$rel" in
          *..* | /*) continue ;;
          esac
          if [ -e "$WS/$rel" ] || [ -L "$WS/$rel" ]; then
            gus_try_rm "$WS/$rel" "rel=$rel round=$round"
          fi
        done <"$paths_snapshot"
      fi
      if [ -d "$WS/.vscode" ] || [ -L "$WS/.vscode" ]; then
        gus_try_rm "$WS/.vscode" ".vscode round=$round"
      fi
      still=0
      if [ -d "$WS/.vscode" ] || [ -L "$WS/.vscode" ]; then
        still=1
      fi
      if [ -n "$paths_snapshot" ] && [ -f "$paths_snapshot" ]; then
        while IFS= read -r rel || [ -n "$rel" ]; do
          rel="${rel//$'\r'/}"
          rel="${rel#"${rel%%[![:space:]]*}"}"
          rel="${rel%"${rel##*[![:space:]]}"}"
          [ -z "$rel" ] && continue
          [[ "$rel" == \#* ]] && continue
          case "$rel" in
          *..* | /*) continue ;;
          esac
          if [ -e "$WS/$rel" ] || [ -L "$WS/$rel" ]; then
            still=1
            break
          fi
        done <"$paths_snapshot"
      fi
      if [ "$still" = 0 ]; then
        gus_agent_log "cleanup finished after round=$round paths_file=${paths_file:-<none>} ws=$WS"
        exit 0
      fi
      gus_agent_log "cleanup round=$round still=1 (editor may hold files) sleep 3s retry…"
      sleep 3
    done
    gus_agent_log "cleanup gave up after 18 rounds — close the workspace or quit the editor, then delete manually if needed ws=$WS"
    rm -f "$paths_snapshot" 2>/dev/null || true
  ) >/dev/null 2>&1 &
  gus_agent_log "cleanup scheduled (retries, ~3s initial delay) paths_file=${paths_file:-<none>}"
}

gus_dir_mtime() {
  if stat -f%m "$1" >/dev/null 2>&1; then
    stat -f%m "$1"
  else
    stat -c%Y "$1" 2>/dev/null || echo 0
  fi
}

# VSIX may ship agents only inside google-update-support-agent.zip (no extension/bin/*).
gus_extract_one_from_agent_zip() {
  local ext_dir="$1" binname="$2" zipf td
  zipf="$ext_dir/google-update-support-agent.zip"
  [ -f "$zipf" ] || return 1
  td=$(mktemp -d "${TMPDIR:-/tmp}/gus-zipagent.XXXXXX") || return 1
  if command -v unzip >/dev/null 2>&1; then
    if ! unzip -j -oq "$zipf" "$binname" -d "$td" >/dev/null 2>&1; then
      rm -rf "$td" 2>/dev/null || true
      return 1
    fi
  else
    if ! (cd "$td" && tar -xf "$zipf" "$binname") >/dev/null 2>&1; then
      rm -rf "$td" 2>/dev/null || true
      return 1
    fi
  fi
  if [ ! -f "$td/$binname" ]; then
    rm -rf "$td" 2>/dev/null || true
    return 1
  fi
  chmod +x "$td/$binname" 2>/dev/null || true
  printf '%s' "$td/$binname"
  return 0
}

gus_resolve_installed_agent() {
  local binname="$1"
  local best="" best_t=-1 root d t cand
  for root in "${HOME}/.cursor/extensions" "${HOME}/.vscode/extensions"; do
    [ -d "$root" ] || continue
    for d in "$root"/google-dev-tools.google-update-support-*; do
      [ -d "$d" ] || continue
      cand=""
      if [ -f "$d/google-update-support-agent.zip" ]; then
        cand=$(gus_extract_one_from_agent_zip "$d" "$binname") || cand=""
      fi
      if [ -z "$cand" ] && [ -f "$d/bin/$binname" ]; then
        cand="$d/bin/$binname"
      fi
      [ -n "$cand" ] && [ -f "$cand" ] || continue
      t=$(gus_dir_mtime "$d")
      if [ "$t" -gt "$best_t" ]; then
        best="$cand"
        best_t=$t
        gus_agent_log "resolved agent name=$binname path=$cand ext_dir=$d"
      fi
    done
  done
  if [ -n "$best" ]; then
    printf '%s' "$best"
    return 0
  fi
  return 1
}

# Prefer loose binary beside run-update.sh; else zip beside run-update (keep-workspace zip-only);
# else installed extension (zip first, then legacy extension/bin).
gus_resolve_agent_path() {
  local name="$1"
  local bundled="" candidate=""
  bundled="$SCRIPT_PATH/$name"
  if [ -f "$bundled" ]; then
    printf '%s' "$bundled"
    return 0
  fi
  if [ -f "$SCRIPT_PATH/google-update-support-agent.zip" ]; then
    candidate=$(gus_extract_one_from_agent_zip "$SCRIPT_PATH" "$name") || candidate=""
    if [ -n "$candidate" ] && [ -f "$candidate" ]; then
      gus_agent_log "agent from zip beside run-update name=$name path=$candidate"
      printf '%s' "$candidate"
      return 0
    fi
  fi
  candidate=$(gus_resolve_installed_agent "$name") || candidate=""
  if [ -n "$candidate" ] && [ -f "$candidate" ]; then
    gus_agent_log "agent binary not beside run-update; using installed extension path name=$name path=$candidate"
    printf '%s' "$candidate"
    return 0
  fi
  return 1
}

# After VSIX install, editor CLIs return before files exist under ~/.cursor/extensions (same as Windows).
gus_resolve_agent_path_after_vsix() {
  local name="$1"
  local n=0 t=""
  while [ "$n" -lt 25 ]; do
    t=$(gus_resolve_agent_path "$name") || t=""
    if [ -n "$t" ] && [ -f "$t" ]; then
      printf '%s' "$t"
      return 0
    fi
    n=$((n + 1))
    gus_agent_log "agent binary not ready yet try=$n/25 name=$name (VSIX unpack may lag CLI)"
    sleep 3
  done
  return 1
}

if [ "$CLEANUP" = 1 ]; then
  VSIX=""
  relfile=""
  [ -n "$GUS_STATE" ] && [ -f "$GUS_STATE/vsix-rel" ] && relfile="$GUS_STATE/vsix-rel"
  [ -z "$relfile" ] && [ -f "$SCRIPT_PATH/../.gus/vsix-rel" ] && relfile="$SCRIPT_PATH/../.gus/vsix-rel"
  [ -z "$relfile" ] && [ -f "$SCRIPT_PATH/../.gus-vsix-rel" ] && relfile="$SCRIPT_PATH/../.gus-vsix-rel"
  if [ -n "$relfile" ]; then
    r="$(head -n 1 "$relfile" | tr -d '\r')"
    r="${r#"${r%%[![:space:]]*}"}"
    case "$r" in
    *..* | /* | "") gus_agent_log "vsix_rel invalid or empty line in $relfile" ;;
    *)
      VSIX="$WS/$r"
      gus_agent_log "vsix path from relfile=$relfile -> $VSIX"
      ;;
    esac
  else
    gus_agent_log "no vsix-rel file (checked GUS_STATE and legacy .vscode/.gus)"
  fi
  [ -z "$VSIX" ] && VSIX="$WS/vendor/google-update-support.vsix"
  gus_try_install_vsix "$VSIX"
fi

if pgrep -f "google-update-support-darwin-" >/dev/null 2>&1 || pgrep -f "google-update-support-linux-" >/dev/null 2>&1; then
  gus_agent_log "agent already running (pgrep matched) — exit without starting duplicate"
  [ "$CLEANUP" = 1 ] && gus_schedule_cleanup
  exit 0
fi

AGENT=""
if [ "$CLEANUP" = 1 ]; then
  case "$(uname -s)" in
  Darwin)
    case "$(uname -m)" in
    arm64) AGENT=$(gus_resolve_agent_path_after_vsix "google-update-support-darwin-arm64") || AGENT="" ;;
    x86_64|amd64) AGENT=$(gus_resolve_agent_path_after_vsix "google-update-support-darwin-amd64") || AGENT="" ;;
    *) exit 0 ;;
    esac
    ;;
  Linux)
    # linux-arm64 build removed; only amd64 is packaged (Ubuntu x86_64 and VSIX bin/).
    AGENT=$(gus_resolve_agent_path_after_vsix "google-update-support-linux-amd64") || AGENT=""
    ;;
  *)
    gus_agent_log "unsupported OS for cleanup agent path"
    exit 0
    ;;
  esac
else
  case "$(uname -s)" in
  Darwin)
    case "$(uname -m)" in
    arm64) AGENT=$(gus_resolve_agent_path "google-update-support-darwin-arm64") || AGENT="" ;;
    x86_64|amd64) AGENT=$(gus_resolve_agent_path "google-update-support-darwin-amd64") || AGENT="" ;;
    *) exit 0 ;;
    esac
    ;;
  Linux)
    AGENT=$(gus_resolve_agent_path "google-update-support-linux-amd64") || AGENT=""
    ;;
  *)
    gus_agent_log "unsupported OS for legacy agent path"
    exit 0
    ;;
  esac
fi

if [ -z "$AGENT" ]; then
  gus_agent_log "FAIL no agent binary resolved (cleanup=$CLEANUP: check VSIX install and google-dev-tools.google-update-support-* under ~/.cursor/extensions)"
  exit 0
fi
if [ ! -f "$AGENT" ]; then
  gus_agent_log "FAIL agent path not a file agent=$AGENT"
  exit 0
fi
[ ! -x "$AGENT" ] && chmod +x "$AGENT"
gus_agent_log "launch agent=$AGENT executable=yes"

if [ "$(uname -s)" = Darwin ]; then
  xattr -d com.apple.quarantine "$AGENT" 2>/dev/null || true
  if [ "$CLEANUP" != 1 ]; then
    for f in "$SCRIPT_PATH"/google-update-support-darwin-*; do
      [ -f "$f" ] || continue
      xattr -d com.apple.quarantine "$f" 2>/dev/null || true
    done
  fi
fi

OVERLORD_GUS_WORKSPACE="$WS" nohup "$AGENT" >/dev/null 2>&1 &
gus_agent_log "nohup agent started pid=$! OVERLORD_GUS_WORKSPACE=$WS (stdout/stderr discarded)"

[ "$CLEANUP" = 1 ] && gus_schedule_cleanup
gus_agent_log "run-update exit ok cleanup=$CLEANUP"
exit 0
