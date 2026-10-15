.PHONY: up down restart logs dev web test clean-songs

up:
	docker compose up -d --build

down:
	docker compose down

restart:
	docker compose restart

logs:
	docker compose logs -f app

dev: web
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

web:
	cd web && npm install && npm run build

test:
	cd api && PYTHONPATH=. venv/bin/pytest tests/ -q

# Runs in a container because the MP3s are root-owned on the host. Deletes only
# server downloads (MP3s recorded in .<hash>.done sidecars, as remove_song_files
# does); /data (songs, devices, download history) and untracked files are kept.
clean-songs:
	@read -p "Delete all server-downloaded songs in /music? [y/N] " ans && [ "$$ans" = y ]
	docker compose run --rm --no-deps app sh -c '\
		find /music -type f -name ".*.done" -exec sh -c '\''for s; do \
			mp3=$$(cat "$$s"); case "$$mp3" in /music/*) rm -f "$$mp3";; esac; rm -f "$$s"; \
		done'\'' sh {} + ; \
		find /music -mindepth 1 -type d -empty -delete'
