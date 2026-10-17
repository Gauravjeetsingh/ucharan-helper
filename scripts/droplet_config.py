"""Render reviewable deployment configuration without installing anything."""
import argparse
from pathlib import Path
from backend.deployment import public_origin

BASE = '/opt/uchaaran-helper'


def configs(domain=''):
    origin = public_origin(f'https://{domain}') if domain else ''
    environment = f'''UCHAARAN_DEPLOYED_DEMO=1
UCHAARAN_PUBLIC_ORIGIN={origin}
PYTHONDONTWRITEBYTECODE=1
PYTHONUNBUFFERED=1
OMP_NUM_THREADS=2
HF_HOME=/tmp/uchaaran-huggingface
'''
    service = f'''# Managed by Uchaaran Helper droplet installer
[Unit]
Description=Uchaaran Helper demo
After=network.target

[Service]
Type=simple
User=uchaaran
Group=uchaaran
WorkingDirectory={BASE}/current
EnvironmentFile=/etc/uchaaran-helper/environment
ExecStart={BASE}/shared/venv/bin/python serve.py --port 8767
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
LimitCORE=0
MemorySwapMax=0
UMask=0077

[Install]
WantedBy=multi-user.target
'''
    result = {'environment': environment, 'uchaaran-helper.service': service}
    if domain:
        result['Caddyfile'] = f'''# Managed by Uchaaran Helper droplet installer
{domain} {{
    request_body {{
        max_size 80MB
    }}
    reverse_proxy 127.0.0.1:8767 {{
        transport http {{
            response_header_timeout 300s
        }}
    }}
}}
'''
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--domain', default='')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    values = configs(args.domain)
    args.output.mkdir(parents=True, exist_ok=True)
    for name, value in values.items():
        (args.output / name).write_text(value, encoding='utf-8')


if __name__ == '__main__':
    main()
