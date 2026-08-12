# hugmesh-mastodon-ui — developer make targets.
#
# `make pentest` runs the repo-local OWASP self-scan that MIRRORS the CI
# pentest stage (.gitlab-ci.yml -> pentest:sca / pentest:dast, which extend the
# centralized generator templates at /tests/pentest/ci/pentest-stage.gitlab-ci.yml).
# Self-contained + non-hard-failing: skips gracefully when tooling / a DAST
# target is absent.

.PHONY: pentest pentest-sca pentest-dast

# Path the shared OWASP harness is checked out / vendored at. Defaults to a
# sibling hugmesh-generator checkout; override to point elsewhere.
GENERATOR_DIR ?= ../hugmesh-generator
PENTEST_HARNESS ?= $(GENERATOR_DIR)/tests/pentest/run-pentest.sh

# SCA: Angular repo -> npm audit (CI uses OWASP Dependency-Check over the
# checkout; npm audit is the fast local mirror). --audit-level=high matches the
# centralized SCA's CVSS>=7 fail posture as closely as npm audit allows.
pentest-sca:
	@echo "==> [SCA] Angular dependency audit (mirrors CI .pentest-sca / Dependency-Check)"
	@if command -v npm >/dev/null 2>&1; then \
		npm audit --audit-level=high || echo "  (npm audit reported findings — non-blocking locally; CI Dependency-Check is authoritative)"; \
	else \
		echo "  npm not found — skipping SCA (install Node/npm to run locally)"; \
	fi
	@echo "  NOTE: CI runs the FULL OWASP Dependency-Check (owasp/dependency-check image) over the repo checkout."

# DAST: delegate to the shared harness baseline scan when a target is set,
# exactly as the CI pentest:dast job does. Requires DAST_TARGET_URL + the
# harness checkout; no-ops (with guidance) otherwise so `make pentest` always
# succeeds locally without tooling.
pentest-dast:
	@echo "==> [DAST] OWASP ZAP baseline harness (mirrors CI .pentest-dast-baseline)"
	@if [ -z "$(DAST_TARGET_URL)" ]; then \
		echo "  DAST_TARGET_URL not set — skipping DAST. To run:"; \
		echo "    DAST_TARGET_URL=https://your-env-test-build make pentest-dast"; \
	elif [ -x "$(PENTEST_HARNESS)" ]; then \
		echo "  Delegating to shared harness: $(PENTEST_HARNESS)"; \
		ZAP_TARGET="$(DAST_TARGET_URL)" bash "$(PENTEST_HARNESS)" --env compose --scan baseline --pipeline main; \
	else \
		echo "  Shared harness not found at $(PENTEST_HARNESS)."; \
		echo "  Check out the generator and re-run, e.g.:"; \
		echo "    git clone https://github.com/hugmesh-net/hugmesh-generator $(GENERATOR_DIR)"; \
		echo "    DAST_TARGET_URL=$(DAST_TARGET_URL) bash $(PENTEST_HARNESS) --env compose --scan baseline --pipeline main"; \
	fi

# Full local pen-test self-scan = SCA + DAST, mirroring the CI pentest stage.
pentest: pentest-sca pentest-dast
	@echo "==> pentest complete (SCA + DAST self-scan). CI runs the full harness on MR + default branch."
