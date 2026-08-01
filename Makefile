.PHONY: check

check:
	cd web && deno fmt
	cd web && deno lint
	cd web && deno task check
	cd web && deno test -A

start:
	docker compose up

stop:
	docker compose down