.PHONY: check

# Les tests touchant la base (villes, rues, foyers, session) ont besoin de
# DATABASE_URL/SESSION_SECRET, définis uniquement dans le conteneur `app`
# (voir compose.yaml) : nécessite `make start` au préalable.
check:
	docker exec -w /web notre_rue_web deno fmt
	docker exec -w /web notre_rue_web deno lint
	docker exec -w /web notre_rue_web deno task check
	docker exec -w /web notre_rue_web deno test -A

start:
	docker compose up

stop:
	docker compose down