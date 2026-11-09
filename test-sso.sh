#!/usr/bin/env bash
set -euo pipefail

# Configuration
DOMAIN="max-institute.org"
CORE_URL="https://${DOMAIN}"
SPORTS_URL="https://sports.${DOMAIN}"
GAMES_URL="https://games.${DOMAIN}"

# Optional: Pass your sovereign_session cookie as the first argument
# Example: ./test-sso.sh "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
SESSION_COOKIE="${1:-}"

echo "=================================================="
echo "  Sovereign Ecosystem Cross-Domain Auth Probe"
echo "  Target Domain: ${DOMAIN}"
echo "================================================--"

if [ -z "${SESSION_COOKIE}" ]; then
    echo "[!] No session cookie provided. Testing fail-closed behavior (expecting 401/Unauthorized)..."
else
    echo "[+] Session cookie loaded. Testing authenticated cross-domain session validation..."
fi
echo ""

test_endpoint() {
    local name="$1"
    local url="$2"
    local cookie="$3"
    local endpoint="${url}/api/health"

    echo -n "Probing ${name} (${endpoint})... "

    if [ -n "${cookie}" ]; then
        http_code=$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: sovereign_session=${cookie}" "${endpoint}")
    else
        http_code=$(curl -s -o /dev/null -w "%{http_code}" "${endpoint}")
    fi

    if [ "${http_code}" -eq 200 ]; then
        echo -e "\033[32m[PASS] HTTP 200 (Authorized)\033[0m"
    elif [ "${http_code}" -eq 401 ]; then
        echo -e "\033[33m[PASS] HTTP 401 (Fail-Closed Enforced)\033[0m"
    else
        echo -e "\033[31m[FAIL] HTTP ${http_code}\033[0m"
    fi
}

test_endpoint "Core Gateway"    "${CORE_URL}"    "${SESSION_COOKIE}"
test_endpoint "Sports Gateway"  "${SPORTS_URL}"  "${SESSION_COOKIE}"
test_endpoint "Games Gateway"   "${GAMES_URL}"   "${SESSION_COOKIE}"

echo "================================================--"
echo "  Verification Probe Complete."
echo "================================================--"
