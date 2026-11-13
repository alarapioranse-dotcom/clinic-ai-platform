# Production storage-key read check (Scaleway, from Termux)

**Status:** executed by the Owner on 2026-11-13 from Termux, every result as expected; see
[Execution record](#execution-record-2026-11-13) at the end. **Scope:** the production
knowledge-document bucket in Scaleway `fr-par`, reached with the production application's own
storage key (the `SCALEWAY_*` values of the Render web service `clinic-ai-platform`), from the
Owner's Termux. No database is touched. This file contains no secret: the key id and secret are
typed into Termux with `read -rs` and never written down.

## Why

CLAUDE.md and [`06-knowledge-document-storage.md`](../technical/06-knowledge-document-storage.md)
record as unverified in production: that the application's storage key can **read** objects (upload
completion's 1024-byte prefix read, ADR-0021, and the whole-object read for text extraction,
ADR-0026); that Scaleway honours `Range: bytes=0-1023` and `If-Match` on GET; that HeadObject
returns an ETag; and that the bucket stays private. Until these hold, extraction, and therefore
search (ADR-0030), cannot work for a real clinic.

## What it does

With the application's key, and plain `curl --aws-sigv4` (no SDK, no repository code):

1. uploads one synthetic 61-byte PDF-shaped file (no real data) to
   `ops-checks/storage-read-check-<UTC timestamp>.pdf` — a prefix that can never be a clinic id, so
   the application never sees it;
2. HeadObject: expects `200`, an ETag, `application/pdf`, length 61;
3. GET with `Range: bytes=0-1023` and `If-Match: <ETag>`: expects `206` (or `200`) and the same
   bytes — this is the **read permission** the check is about;
4. GET with a wrong `If-Match`: expects `412`;
5. full GET with `If-Match: <ETag>`: expects `200` and the same bytes;
6. GET with no credentials: expects `403` (the bucket is private);
7. deletes the file: expects `204`, then HeadObject `404`.

Decision rules: a `403` at step 3 or 5 means the key cannot read — **stop**, still run step 7, and
report: granting read is a production infrastructure change that needs its own Owner decision.
A `200` at step 4 means `If-Match` is ignored, and a `200` at step 6 means the bucket is public:
stop and report either. If step 7's delete returns `403`, the synthetic file stays in the bucket
(no lifecycle rule removes it); record its key — it holds no data.

## Steps

### 1. Values (Render dashboard → `clinic-ai-platform` → Environment)

Termux must not receive the values in the same paste as the commands that ask for them: a pasted
block feeds its own next lines to `read` as input. So this step is three separate pastes. First
clear anything left from an earlier attempt:

```sh
unset S3_ENDPOINT S3_REGION S3_BUCKET S3_KEY_ID S3_SECRET; history -c; history -w; clear; echo RESET-DONE
```

Then write the input script (it asks for nothing yet):

```sh
mkdir -p ~/s3c && cd ~/s3c && cat > in.sh <<'EOF'
read -rp "SCALEWAY_S3_ENDPOINT: " S3_ENDPOINT
read -rp "SCALEWAY_S3_REGION: " S3_REGION
read -rp "SCALEWAY_S3_BUCKET: " S3_BUCKET
read -rsp "SCALEWAY_ACCESS_KEY_ID (hidden): " S3_KEY_ID; echo
read -rsp "SCALEWAY_SECRET_ACCESS_KEY (hidden): " S3_SECRET; echo
S3_ENDPOINT="${S3_ENDPOINT%/}"
export S3_ENDPOINT S3_REGION S3_BUCKET S3_KEY_ID S3_SECRET
case "$S3_ENDPOINT|$S3_REGION" in
  "https://s3.fr-par.scw.cloud|fr-par") echo "ENDPOINT-OK" ;;
  *) echo "STOP: unexpected endpoint or region" ;;
esac
[ -n "$S3_BUCKET" ] && [ -n "$S3_KEY_ID" ] && [ -n "$S3_SECRET" ] && echo "VALUES-SET bucket=$S3_BUCKET" || echo "STOP: a value is empty"
EOF
echo FILE-READY
```

Then run it alone, and paste each value (copy button in Render) when it is asked for:

```sh
source ~/s3c/in.sh
```

Expected: `ENDPOINT-OK` and `VALUES-SET bucket=<name>`.

### 2. Upload the synthetic file and read its metadata

```sh
cd ~/s3c
printf '%%PDF-1.4\n%% Synthetic storage read check. No real data.\n%%%%EOF\n' > check.pdf
export S3_OBJ="ops-checks/storage-read-check-$(date -u +%Y%m%dT%H%M%SZ).pdf"
s3() { curl -sS --aws-sigv4 "aws:amz:$S3_REGION:s3" --user "$S3_KEY_ID:$S3_SECRET" -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" "$@"; }
s3 -o /dev/null -w "PUT %{http_code}\n" -X PUT -H "Content-Type: application/pdf" --data-binary @check.pdf "$S3_ENDPOINT/$S3_BUCKET/$S3_OBJ"
s3 -I "$S3_ENDPOINT/$S3_BUCKET/$S3_OBJ" | tr -d '\r' | grep -iE '^HTTP|^etag:|^content-type:|^content-length:'
export S3_ETAG="$(s3 -I "$S3_ENDPOINT/$S3_BUCKET/$S3_OBJ" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')"
echo "ETAG=${S3_ETAG:-MISSING}"
```

Expected: `PUT 200`; `HTTP/... 200`, an `ETag`, `Content-Type: application/pdf`, `Content-Length: 61`;
`ETAG="..."` (not `MISSING`).

### 3. The reads

```sh
cd ~/s3c
s3 -o prefix.bin -w "RANGE-GET %{http_code}\n" -H "Range: bytes=0-1023" -H "If-Match: $S3_ETAG" "$S3_ENDPOINT/$S3_BUCKET/$S3_OBJ"
cmp -s prefix.bin check.pdf && echo "PREFIX-MATCHES" || echo "PREFIX-DIFFERS"
s3 -o /dev/null -w "WRONG-ETAG %{http_code}\n" -H 'If-Match: "00000000000000000000000000000000"' "$S3_ENDPOINT/$S3_BUCKET/$S3_OBJ"
s3 -o full.bin -w "FULL-GET %{http_code}\n" -H "If-Match: $S3_ETAG" "$S3_ENDPOINT/$S3_BUCKET/$S3_OBJ"
cmp -s full.bin check.pdf && echo "FULL-MATCHES" || echo "FULL-DIFFERS"
curl -sS -o /dev/null -w "ANONYMOUS %{http_code}\n" "$S3_ENDPOINT/$S3_BUCKET/$S3_OBJ"
```

Expected: `RANGE-GET 206` (or `200`), `PREFIX-MATCHES`, `WRONG-ETAG 412`, `FULL-GET 200`,
`FULL-MATCHES`, `ANONYMOUS 403`.

### 4. Delete the synthetic file (always run, whatever step 3 showed)

```sh
cd ~/s3c
s3 -o /dev/null -w "DELETE %{http_code}\n" -X DELETE "$S3_ENDPOINT/$S3_BUCKET/$S3_OBJ"
s3 -o /dev/null -w "HEAD-AFTER %{http_code}\n" -I "$S3_ENDPOINT/$S3_BUCKET/$S3_OBJ"
echo "OBJECT=$S3_OBJ"
```

Expected: `DELETE 204`, `HEAD-AFTER 404`.

### 5. Clean up

```sh
unset S3_ENDPOINT S3_REGION S3_BUCKET S3_KEY_ID S3_SECRET S3_OBJ S3_ETAG && unset -f s3 && cd ~ && rm -rf ~/s3c && history -c && history -w && echo CLEARED
```

## Rehearsal (2026-11-13)

The blocks above were run unchanged (except the endpoint guard and the region, `us-east-1`, which
the stand-in requires) against a local S3-compatible stand-in (moto server) with curl 8.5:
`PUT 200`; HeadObject `200` with an ETag, `application/pdf`, length 61; `RANGE-GET 206`,
`PREFIX-MATCHES`; `WRONG-ETAG 412`; `FULL-GET 200`, `FULL-MATCHES`; `ANONYMOUS 403`; `DELETE 204`,
`HEAD-AFTER 404`. The stand-in does not check signatures, so the rehearsal proves the commands and
the expected outputs, not Scaleway's behaviour — that is what the production run is for.

## Execution record (2026-11-13)

Run by the Owner from Termux after #141 was merged (main `f5b8a6d`):

- First attempt at step 1: the original single block, pasted together with its prompts, fed its own
  lines to `read`, so the values typed afterwards ran as shell commands (`command not found`).
  Nothing was sent anywhere and nothing changed in Scaleway or Render; the shell history was
  cleared (`history -c; history -w`). Step 1 above is now three separate pastes for that reason.
- Step 1 (three pastes): `ENDPOINT-OK`, `VALUES-SET bucket=clinic-ai-knowledge-docs`.
- Step 2: `PUT 200`; HeadObject `HTTP/2 200`, `content-length: 61`, `content-type: application/pdf`,
  `etag: "459f771a580c77a41388d4c4c4beb6f4"`.
- Step 3: `RANGE-GET 206`, `PREFIX-MATCHES`; `WRONG-ETAG 412`; `FULL-GET 200`, `FULL-MATCHES`;
  `ANONYMOUS 403`.
- Step 4: `DELETE 204`, `HEAD-AFTER 404` for
  `ops-checks/storage-read-check-20261113T212426Z.pdf`; the bucket holds nothing from this check.
- Step 5: `CLEARED`.

Result: the production application's storage key can write, read (ranged and whole, bound to the
ETag) and delete objects; Scaleway honours `Range` and `If-Match` and returns an ETag; the bucket
refuses anonymous reads. This does not exercise the application's own SDK code in production; the
first legitimate upload will.
