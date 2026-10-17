"""Upload this working copy and run the Ubuntu installer over SSH.

python3 -m scripts.deploy_to_droplet root@DROPLET_IP [--domain paath.example.org]
Uses existing SSH authentication; credentials are never bundled.
"""
import argparse
import re
import shlex
import subprocess
import tarfile
import tempfile
from pathlib import Path
from .deployment_files import ROOT, files
from .droplet_config import configs


def bundle(root, destination):
    selected = list(files(root))
    with tarfile.open(destination,'w:gz') as archive:
        for relative in selected:
            archive.add(root/relative,arcname=str(relative),recursive=False)


def connection_args(remote, port, identity=None):
    if not re.fullmatch(r'(?:[a-zA-Z0-9_][a-zA-Z0-9_-]*@)?[a-zA-Z0-9][a-zA-Z0-9._-]*',remote):
        raise ValueError('Use user@IPv4, user@hostname, or an SSH-config alias.')
    if not 1 <= port <= 65535:
        raise ValueError('SSH port must be between 1 and 65535.')
    identity_args = ['-i',str(identity)] if identity else []
    return ['ssh','-p',str(port),*identity_args], ['scp','-P',str(port),*identity_args]


def install_command(directory, options):
    path = directory+'/scripts/deploy_droplet.sh'
    unpack = shlex.join(['tar','-xzf',directory+'/source.tar.gz','-C',directory])
    run = shlex.join(['bash',path,*options])
    return unpack+' && if [ "$(id -u)" -eq 0 ]; then '+run+'; else sudo '+run+'; fi'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('remote',help='e.g. root@203.0.113.10')
    parser.add_argument('--domain',default='')
    parser.add_argument('--with-phone-model',action='store_true')
    parser.add_argument('--ssh-port',type=int,default=22)
    parser.add_argument('--identity',type=Path)
    parser.add_argument('--dry-run',action='store_true',help='Print plan; no SSH connection or upload')
    args=parser.parse_args()
    try:
        configs(args.domain)
        ssh,scp=connection_args(args.remote,args.ssh_port,args.identity)
    except ValueError as error:
        parser.error(str(error))
    options=(['--domain',args.domain] if args.domain else [])+(['--with-phone-model'] if args.with_phone_model else [])
    if args.dry_run:
        print('Source:',ROOT)
        print('Target:',args.remote)
        print('Files:',sum(1 for _ in files(ROOT)))
        print('Mode:','HTTPS '+args.domain if args.domain else 'Private SSH tunnel')
        print('Installer:',shlex.join(['sudo','bash','scripts/deploy_droplet.sh',*options]))
        print('No connection made. No files uploaded.')
        return
    with tempfile.TemporaryDirectory(prefix='uchaaran-deploy-') as temporary:
        archive=Path(temporary)/'source.tar.gz'
        bundle(ROOT,archive)
        result=subprocess.run([*ssh,args.remote,'mktemp -d /tmp/uchaaran-upload.XXXXXXXX'],check=True,stdout=subprocess.PIPE,text=True)
        directory=result.stdout.strip()
        if not re.fullmatch(r'/tmp/uchaaran-upload\.[a-zA-Z0-9]+',directory):
            raise RuntimeError('SSH did not return the expected temporary upload directory.')
        try:
            subprocess.run([*scp,str(archive),f'{args.remote}:{directory}/source.tar.gz'],check=True)
            subprocess.run([*ssh,'-t',args.remote,install_command(directory,options)],check=True)
        except subprocess.CalledProcessError:
            print('Installation failed; source upload left at',directory,'on the droplet for inspection.')
            raise
        subprocess.run([*ssh,args.remote,shlex.join(['rm','-rf','--',directory])],check=True)
    if not args.domain:
        print('\nKeep this SSH tunnel running on your laptop:')
        print(shlex.join([*ssh,'-N','-L','8767:127.0.0.1:8767',args.remote]))
        print('Then open http://127.0.0.1:8767. Stop your local dev server first if that port is busy.')


if __name__ == '__main__':
    main()
