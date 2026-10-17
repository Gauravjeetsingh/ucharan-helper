# Install on a DigitalOcean droplet

Supported: **Ubuntu 24.04 LTS, x86_64/amd64**, with sudo/root access and outbound
package/model downloads. Check the droplet with `cat /etc/os-release` and
`dpkg --print-architecture`. Other releases fail before installation. No
DigitalOcean API token, Node, GPU, or Docker is needed on the droplet.
Use a 4 GB RAM droplet as a starting point; CPU inference latency and concurrent
capacity have not been benchmarked. The optional phone model uses more memory
and downloads about 1.26 GB in addition to the timestamp model (~184 MB).

## One command from your laptop

From this repository, using your existing SSH login:

```sh
python3 -m scripts.deploy_to_droplet root@DROPLET_IP
```

The launcher packages the current working copy, including uncommitted app
changes, uploads it, and runs the installer. No GitHub push is required.
It copies app/backend/setup source, canonical lesson JSON and supplied reference
recordings. It excludes `.local`, SSH keys, `.env`, Git history, models, virtual
environments, caches, generated evidence, and local/student recording folders.
Normal SSH host-key checks remain enabled. `--identity /path/to/key` and
`--ssh-port 2222` are available; the key itself is never uploaded. Non-root SSH
users need sudo access and may be prompted for their sudo password.

Without a domain, the app binds only to the droplet's loopback address. Keep
an SSH tunnel running on your laptop:

```sh
ssh -N -L 8767:127.0.0.1:8767 root@DROPLET_IP
```

Open **http://127.0.0.1:8767** on that laptop. Stop your local dev server first
if it already occupies port 8767. Keep the tunnel on local port 8767 so the
app’s localhost Host/Origin checks match.
No inbound web ports are needed in this mode; preserve your existing SSH rule.
The tunnel also gives the browser a localhost secure context for microphone
access, without needing a domain or an untrusted certificate.

## Share through a domain with HTTPS

1. Point a domain/subdomain's DNS A record at the droplet's public IPv4 address.
   Only add an AAAA record if IPv6 also routes to this droplet.
2. Allow inbound TCP **80 and 443** in any existing DigitalOcean/host firewall,
   preserving SSH access. The installer never resets/enables your firewall or
   changes SSH configuration.
3. Run from your laptop:

```sh
python3 -m scripts.deploy_to_droplet root@DROPLET_IP --domain paath.example.org
```

Caddy obtains and renews HTTPS certificates. Open **https://paath.example.org**;
a raw `http://DROPLET_IP` address does not provide browser microphone access.
For later deployments, supply the same `--domain` argument. The installer
refuses to overwrite an existing unrelated Caddy site or a listening web server
on first installation. Existing sites need a manually integrated proxy config.

## What gets installed

- Python 3.12 virtual environment and pinned timestamp dependencies/model.
  This enables timestamp generation and the existing Learn comparison.
- FFmpeg, which prepares the supplied Japji Sahib MOV as a shared 16 kHz WAV.
- An unprivileged `uchaaran` service user and `uchaaran-helper.service`, enabled
  at boot. The Python application still binds to `127.0.0.1:8767` only.
- With `--domain`, Caddy forwards the real Host/Origin headers to the explicit
  configured HTTPS origin. Other origins remain rejected. The installer limits
  proxy request bodies and does not enable access logs or audio-body logging.
- Reference/correction editing endpoints are disabled in the hosted demo.

Optional voicing checks need the separate phone model. Add
`--with-phone-model` to either launcher or installer. This installs CPU-only
PyTorch, the pinned phonetic dependencies, and the pinned phone model. The
standard installation works without it; the phone-specific voicing check then
remains unavailable. There is one shared inference lock: simultaneous
comparisons may return a busy response. This is a small hackathon deployment,
not a measured production capacity or calibrated pronunciation service.

## Audio handling

In hosted mode, Learn sends the student's recording **to your droplet** for
comparison, including when accessed through an SSH tunnel. It is no longer
strictly on the student's device. The app displays this beside the recording
controls. Recordings stay in browser/server-process memory and are not
intentionally saved, logged, sent to model publishers, or retained automatically.
Model downloads happen during setup. Explicit “Save my attempt” downloads still
go to the student's computer. Disable any separate request-body capture or
recording middleware you may have configured outside this app.

## Preview or run directly on the droplet

Preview from your laptop, without connecting to the droplet:

```sh
python3 -m scripts.deploy_to_droplet root@DROPLET_IP --domain paath.example.org --dry-run
bash scripts/deploy_droplet.sh --domain paath.example.org --dry-run
```

If the current repository is already on the droplet, the installer alone is:

```sh
sudo bash scripts/deploy_droplet.sh
# Or enable public HTTPS:
sudo bash scripts/deploy_droplet.sh --domain paath.example.org
```

Each run creates a fresh source release under `/opt/uchaaran-helper/releases`
and switches `/opt/uchaaran-helper/current` only after dependencies, models,
audio and configuration are ready. Models, the reference WAV and the venv are
reused under `/opt/uchaaran-helper/shared`. Older releases remain available;
they are not automatically deleted. Failed setup leaves the existing running
service in place until the activation step. Activation/health-check failure is
reported; automatic rollback is not claimed.

```sh
sudo systemctl status uchaaran-helper
sudo journalctl -u uchaaran-helper -n 60
sudo systemctl restart uchaaran-helper
sudo systemctl status caddy    # Domain installations only
```

The installer checks service health and a reference-audio clip. Public DNS,
certificate issuance and real microphone/inference quality still need a check
from your browser after installation. No droplet installation is performed by
previewing these files or running repository tests.

Sources: [Caddy HTTPS](https://caddyserver.com/docs/automatic-https),
[Caddy proxy headers](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[DigitalOcean firewalls](https://docs.digitalocean.com/products/networking/firewalls/how-to/create/),
[browser microphone secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
