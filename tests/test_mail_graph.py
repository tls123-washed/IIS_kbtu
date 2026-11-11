import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from msal import SerializableTokenCache

from server.config import ROOT, GraphSettings
from server.mail_graph import (
    GraphMailError, authorize, cache_cipher, load_client, save_cache, send_graph,
)


class GraphMailTest(unittest.TestCase):
    def setUp(self):
        folder = self.enterContext(tempfile.TemporaryDirectory(dir=ROOT))
        self.config = GraphSettings("tenant", "client", "owner@kbtu.kz", Path(folder) / "graph.cache")
        self.secret = b"local-only-test-app-secret-for-cache"
        self.addCleanup(load_client.cache_clear)

    def test_cache_round_trip_and_wrong_secret(self):
        cache = SerializableTokenCache()
        cache.deserialize('{"test": "private test data"}')
        save_cache(self.config.cache_path, cache, cache_cipher(self.config, self.secret))
        self.assertNotIn(b"private test data", self.config.cache_path.read_bytes())
        with patch("server.mail_graph.graph_client"):
            _, loaded, _ = load_client(self.config, self.secret)
            self.assertEqual(json.loads(loaded.serialize()), {"test": "private test data"})
        with self.assertRaises(GraphMailError):
            load_client(self.config, b"different-app-secret")

    def test_other_account_does_not_replace_cache(self):
        client = self.enterContext(patch("server.mail_graph.graph_client")).return_value
        client.acquire_token_interactive.return_value = {"access_token": "mock token"}
        client.get_accounts.return_value = []
        with self.assertRaises(GraphMailError):
            authorize(self.config, self.secret)
        self.assertFalse(self.config.cache_path.exists())

    def test_graph_uses_authorized_mailbox_and_handles_rejection(self):
        self.enterContext(patch("server.mail_graph.access_token", return_value="mock token"))
        http = self.enterContext(patch("server.mail_graph.HTTPSConnection"))
        response = MagicMock(status=202)
        http.return_value.getresponse.return_value.__enter__.return_value = response
        args = (self.config, self.secret, "recipient@kbtu.kz", "Campus Threads", "Ваш код: 123456")
        send_graph(*args)
        method, path, body, headers = http.return_value.request.call_args.args
        self.assertEqual((method, path), ("POST", "/v1.0/me/sendMail"))
        self.assertEqual(headers["Authorization"], "Bearer mock token")
        message = json.loads(body)["message"]
        self.assertNotIn("from", message)
        self.assertEqual(message["toRecipients"][0]["emailAddress"]["address"], "recipient@kbtu.kz")
        self.assertIn("123456", message["body"]["content"])
        response.status = 403
        with self.assertRaisesRegex(GraphMailError, "HTTP 403"):
            send_graph(*args)
