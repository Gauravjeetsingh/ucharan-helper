# Deploy on Render

The Render setup is separate from the Ubuntu droplet installer. It uses the
same Python app, pinned timestamp model and supplied ustaad recording.

## First deployment

1. Commit and push the app and deployment files to your GitHub branch. Render
   builds from GitHub, so local changes are not included until pushed.
2. In the [Render dashboard](https://dashboard.render.com/), choose **New →
   Blueprint**, connect `Gauravjeetsingh/ucharan-helper`, and select that branch.
3. Use the root `render.yaml`. Review the instance size and displayed cost,
   then deploy. The configured `2c-4g` instance is a **paid** starting size for
   CPU inference (2 CPUs, 4 GB RAM), not a benchmarked minimum.
4. Wait for the image build, including the ~184 MB pinned model download and
   reference-audio conversion. Open the HTTPS `onrender.com` URL Render assigns.

No domain, SSH access, Render API key, database or persistent disk is required.
Model downloads need public Hugging Face access during the build. Startup uses
the built image and does not download models. Automatic deployment is disabled;
after pushing updates, use **Manual Deploy → Deploy latest commit** on the
service (sync the Blueprint too if `render.yaml` changes).

If creating a web service manually instead, select **Docker**, repository root
as the build context, `./Dockerfile`, and `/healthz` as the health-check path.
Leave the Docker command blank so the image's default command runs.

## What the setup does

- `Dockerfile` installs build tools and FFmpeg in a build stage, then runs
  `bash scripts/render_build.sh` to install the timestamp dependencies, verify
  and download the pinned model, and prepare the full-bani WAV. The final image
  runs as an unprivileged user without compilers or FFmpeg.
- `python -m scripts.render_start` binds to `0.0.0.0:$PORT` (default `10000`). It
  sets the allowed HTTPS origin from Render's `RENDER_EXTERNAL_URL`.
- The main Learn flow, timestamps, Follow along and reference playback are
  included. The older phonetic lab's separate ~1.26 GB phone model is omitted;
  Learn's optional phone-based voicing check remains unavailable in this image.
- Read-only reference editing restrictions and the hosted recording notice are
  enabled. `/healthz` checks HTTP responsiveness without loading the model; a
  healthy response does not prove inference quality or speed.
- `.dockerignore` allowlists app/source and supplied reference data. Local
  credentials, recordings, models, caches, venvs and unrelated files are excluded.

This is the existing hackathon server, packaged for a hosted demo. Student
recordings are sent over HTTPS to your Render process for in-memory comparison;
the app does not save them or log request bodies. This is server-side processing,
not device-only inference. The page shows a notice before recording. Follow
along does not upload student audio.

## Custom domain (optional)

Add your domain using Render's **Settings → Custom Domains** and its DNS
instructions. Set `UCHAARAN_PUBLIC_ORIGIN=https://paath.example.org` in the
service's environment and redeploy. Use the domain without a trailing slash or
port. The server accepts this one public origin; after this change, use the
custom domain for the app instead of the `onrender.com` address. Health checks
remain independent of the configured domain. Do not set this variable just to
use the normal Render address; `RENDER_EXTERNAL_URL` is supplied automatically.

## Local container verification (optional)

Requires Docker; it downloads dependencies/model and builds Linux amd64 to match
the pinned ONNX Runtime deployment environment:

```sh
docker build --platform linux/amd64 -t ucharan-helper:render .
docker run --rm --platform linux/amd64 -p 10000:10000 \
  -e RENDER_EXTERNAL_URL=https://demo.onrender.com ucharan-helper:render
```

Open <http://localhost:10000>. Loopback requests remain available for local
testing; public requests require the configured HTTPS origin. For a hosted
check, `/api/status` reports `local_only: false` and
`timestamp_model_present: true`. Try playback and one Learn recording as well.

Source/config checks without downloads:

```sh
python -m unittest tests.test_render_deployment tests.test_deployment tests.test_server
```

Render documentation: [Docker](https://render.com/docs/docker),
[Blueprint fields](https://render.com/docs/blueprint-spec),
[port binding](https://render.com/docs/web-services#port-binding),
[default environment variables](https://render.com/docs/environment-variables),
[health checks](https://render.com/docs/health-checks).
