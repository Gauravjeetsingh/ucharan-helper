"""Deployment config, packaging and origin policy; no model or cloud access."""
import json
import subprocess
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from backend.deployment import public_origin
from backend.server import Handler
from scripts.deployment_files import copy_source
from scripts.droplet_config import configs
from scripts.deploy_to_droplet import bundle, connection_args, install_command
import tarfile

ROOT = Path(__file__).resolve().parents[1]


class ConfigTests(unittest.TestCase):
    def test_explicit_https_domain(self):
        self.assertIsNone(public_origin(''))
        self.assertEqual(public_origin('https://paath.example.org'), 'https://paath.example.org')
        for bad in ['http://paath.example.org', 'https://paath.example.org/', 'https://user@paath.example.org',
                    'https://paath.example.org:443', 'https://localhost', 'https://bad.example.org\n{\n', 'https://paath.example.org?x=1']:
            with self.subTest(origin=bad), self.assertRaises(ValueError):
                public_origin(bad)

    def test_tunnel_and_https_templates(self):
        private = configs()
        self.assertNotIn('Caddyfile', private)
        self.assertIn('User=uchaaran', private['uchaaran-helper.service'])
        self.assertIn('ProtectSystem=strict', private['uchaaran-helper.service'])
        self.assertIn('LimitCORE=0', private['uchaaran-helper.service'])
        public = configs('paath.example.org')
        self.assertIn('https://paath.example.org', public['environment'])
        self.assertIn('reverse_proxy 127.0.0.1:8767', public['Caddyfile'])
        self.assertNotIn('header_up', public['Caddyfile'])
        self.assertNotIn('log {', public['Caddyfile'])

    def test_copy_includes_local_app_edits_but_never_private_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()/'source'
            for name in ['apps/shared/new-uncommitted.js', 'backend/server.py', 'scripts/deploy_droplet.sh',
                         'data/reference/ustaad.wav', 'data/lessons/lesson.json', '.local/private.key',
                         '.env', 'models/weights.bin', 'data/lessons/audio/student.wav',
                         'data/evidence/student.npy', 'backend/__pycache__/cache.pyc', 'apps/.secret',
                         'apps/learn/node_modules/dependency.js', 'README.md']:
                path = root/name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(name)
            (root/'apps/leak').symlink_to(root/'.local', target_is_directory=True)
            target = Path(temp).resolve()/'release'
            copy_source(root,target)
            selected = {str(p.relative_to(target)) for p in target.rglob('*') if p.is_file()}
            self.assertEqual(selected, {'apps/shared/new-uncommitted.js','backend/server.py','scripts/deploy_droplet.sh',
                                       'data/reference/ustaad.wav','data/lessons/lesson.json','README.md'})
            with self.assertRaises(ValueError): copy_source(root,target)

    def test_launcher_arguments_and_bundle(self):
        ssh,scp=connection_args('root@203.0.113.10',2222,Path('/tmp/key with spaces'))
        self.assertEqual(ssh,['ssh','-p','2222','-i','/tmp/key with spaces'])
        self.assertEqual(scp[0],'scp')
        for remote in ['-oProxyCommand=bad','root@host;command','root@host/path']:
            with self.assertRaises(ValueError): connection_args(remote,22)
        command=install_command('/tmp/uchaaran-upload.ABC123',['--domain','paath.example.org'])
        self.assertIn('sudo bash',command)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve()/'source';root.mkdir()
            (root/'serve.py').write_text('demo')
            (root/'.local').mkdir();(root/'.local/private.key').write_text('private')
            archive=Path(temp)/'source.tar.gz';bundle(root,archive)
            with tarfile.open(archive) as package:self.assertEqual(package.getnames(),['serve.py'])
        result=subprocess.run(['python3','-m','scripts.deploy_to_droplet','root@203.0.113.10','--dry-run'],cwd=ROOT,capture_output=True,text=True,check=True)
        self.assertIn('No connection made',result.stdout)

    def test_installer_syntax_and_non_mutating_preview(self):
        script = ROOT/'scripts/deploy_droplet.sh'
        subprocess.run(['bash','-n',str(script)],check=True)
        result = subprocess.run(['bash',str(script),'--domain','paath.example.org','--dry-run'],capture_output=True,text=True,check=True)
        self.assertIn('Public HTTPS + Caddy',result.stdout)
        self.assertIn('UCHAARAN_PUBLIC_ORIGIN=https://paath.example.org',result.stdout)
        result = subprocess.run(['bash',str(script),'--domain','bad;touch /tmp/injected','--dry-run'],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)


class HostedRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1',0),Handler)
        cls.server.public_origin = 'https://paath.example.org'
        cls.server.deployed_demo = True
        cls.thread = threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()

    def request(self,path,method='GET',headers=None):
        connection = HTTPConnection('127.0.0.1',self.server.server_port,timeout=5)
        connection.request(method,path,body='[]' if method=='POST' else None,headers=headers or {})
        response=connection.getresponse();status,body=response.status,response.read();connection.close()
        return status,body

    def test_public_origin_reads_and_unsafe_requests(self):
        host={'Host':'paath.example.org'}
        self.assertEqual(self.request('/learn',headers=host)[0],200)
        self.assertEqual(self.request('/learn',headers={**host,'Origin':'https://evil.example'})[0],403)
        for origin in [None,'http://paath.example.org','https://evil.example']:
            headers={**host,'Content-Type':'application/json'}
            if origin:headers['Origin']=origin
            self.assertEqual(self.request('/api/timestamps/generate','POST',headers)[0],403)
        status,_=self.request('/api/timestamps/generate','POST',{**host,'Origin':'https://paath.example.org','Content-Type':'application/json'})
        self.assertEqual(status,400) # Passed the origin check, then rejected the invalid body.
        self.assertEqual(self.request('/learn',headers={'Host':'evil.example','X-Forwarded-Host':'paath.example.org'})[0],403)
        self.assertEqual(self.request('/learn',headers={'Origin':'https://paath.example.org'})[0],403)
        status,body=self.request('/api/status',headers=host)
        self.assertEqual(status,200);self.assertFalse(json.loads(body)['local_only'])
        self.assertFalse(json.loads(body)['stores_student_audio'])

    def test_reference_mutations_disabled_even_through_loopback(self):
        for path in ['/api/corrections/save','/api/corrections/delete','/api/learn/screens/cards']:
            self.assertEqual(self.request(path,'POST',{'Content-Type':'application/json'})[0],403)
        self.assertEqual(self.request('/api/corrections/'+'a'*64)[0],403)
        self.assertEqual(self.request('/.git/config',headers={'Host':'paath.example.org'})[0],404)


if __name__ == '__main__': unittest.main()
