#!/usr/bin/env bash
# pi-history.sh: project a pi session JSONL down to its signal.
#
# Kills ~95%+ of session bytes (toolResults, toolCall args, checkpoints,
# scaffolding) and keeps the slices that carry reasoning and the user's own
# words: user turns, questionnaire answers (ask_user_question results), and
# assistant prose WITHOUT toolCalls.
#
# Usage:
#   pi-history.sh                     # newest session for $PWD
#   pi-history.sh --session current   # same, pinned to $PWD
#   pi-history.sh --session <path|id> # explicit session file or id-prefix
#   pi-history.sh --for <repo-dir>    # newest session in that project
#   pi-history.sh --grep <regex>      # newest session across ALL projects
#                                     # matching path OR user/assistant text
#   pi-history.sh --limit 4000        # per-message char cap (default 800)
#   pi-history.sh --with-tools        # also dump error/truncated toolResults
#   pi-history.sh --list              # recent sessions, newest first
#
# Output: U| <user words or questionnaire answers>  /  A| <assistant prose>  /  T| <tool error>

set -euo pipefail

SESS_ROOT="${PI_SESSION_DIR:-$HOME/.pi/agent/sessions}"
LIMIT=800
WITH_TOOLS=0
MODE=current
ARG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --session) MODE=session; ARG="${2:?--session needs a path or id}"; shift 2 ;;
    --for)     MODE=for;     ARG="${2:?--for needs a dir}";          shift 2 ;;
    --grep)    MODE=grep;    ARG="${2:?--grep needs a regex}";       shift 2 ;;
    --limit)   LIMIT="${2:?--limit needs a number}";                 shift 2 ;;
    --with-tools) WITH_TOOLS=1; shift ;;
    --list)    MODE=list; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

case "$LIMIT" in ''|*[!0-9]*) echo "--limit must be a positive integer" >&2; exit 2 ;; esac

slug() { printf -- '--%s--' "$(printf '%s' "$1" | sed 's|/|-|g; s|^-||')"; }

# Newest jsonl in a project dir.
newest_in() {
  find "$SESS_ROOT/$1" -maxdepth 1 -name '*.jsonl' -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | head -1 | cut -d' ' -f2-
}

resolve() {
  case "$MODE" in
    current) newest_in "$(slug "$PWD")" ;;
    for)     [ -d "$ARG" ] || { echo "no such dir: $ARG" >&2; exit 1; }
             newest_in "$(slug "$(cd "$ARG" && pwd)")" ;;
    session) if [ -f "$ARG" ]; then printf '%s' "$ARG"
             else find "$SESS_ROOT" -name "*${ARG}*.jsonl" -printf '%T@ %p\n' \
                    | sort -rn | head -1 | cut -d' ' -f2-
             fi ;;
    grep)    find "$SESS_ROOT" -name '*.jsonl' -printf '%T@ %p\n' \
               | sort -rn | cut -d' ' -f2- \
               | while read -r f; do grep -qiE "$ARG" "$f" && { printf '%s' "$f"; break; }; done ;;
  esac
}

if [ "$MODE" = list ]; then
  find "$SESS_ROOT" -name '*.jsonl' -printf '%T@ %s %p\n' | sort -rn | head -25 \
    | while read -r _ sz p; do printf '%8s KB  %s\n' "$((sz/1024))" "$p"; done
  exit 0
fi

FILE="$(resolve)"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "no session found (mode=$MODE arg=${ARG:-$PWD})" >&2; exit 1; }

# Projection: user turns + assistant prose with zero toolCall blocks, plus
# optional error toolResults. assistant text is joined across blocks; newlines
# collapse to one line so --limit truncates on one physical line.
emit() {
  jq -rc --argjson lim "$LIMIT" --argjson tools "$WITH_TOOLS" '
    select(.type == "message")
    | .message as $m
    | ($m.content
       | if type == "string" then .
         else [ .[] | select(.type == "text") | .text ] | join(" ")
         end
       | gsub("\\s+"; " ")) as $txt
    | if   $m.role == "user"      then ("U| " + $txt[0:$lim])
      elif $m.role == "toolResult" and $m.toolName == "ask_user_question"
                                  then ("U| " + ($txt + (
                                         if ($m.details.cancelled // false)
                                            and (($m.details.globalNote // "") | length) > 0
                                         then " note: " + $m.details.globalNote
                                         else "" end))[0:$lim])
      elif $m.role == "assistant"
           and ([ $m.content[]? | select(.type == "toolCall") ] | length) == 0
                                  then ("A| " + $txt[0:$lim])
      elif $m.role == "toolResult" and $tools == 1 and $m.isError == true
                                  then ("T| [" + ($m.toolName // "?") + "] " + $txt[0:$lim])
      else empty
      end
    | select(length > 4)
  ' "$FILE" 2>/dev/null
}

# Drop assistant ack-noise (<120 chars); keep every user turn.
# AI HERE: 120 is a heuristic for "narration, not substance". Ceiling: a terse
# but real assistant answer under 120 chars is lost. Raise it if that bites.
emit | awk '/^U\|/ || /^T\|/ || length($0) > 120'

# Self-check: the projection must not exceed the source.
raw=$(wc -c < "$FILE")
lean=$(emit | awk '/^U\|/ || /^T\|/ || length($0) > 120' | wc -c)
[ "$lean" -le "$raw" ] || { echo "projection larger than source" >&2; exit 1; }
echo "--- $(basename "$FILE")  ${raw}B -> ${lean}B" >&2
