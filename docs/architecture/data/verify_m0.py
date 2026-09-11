"""V1.2 review-only SQL and application-transaction protocol proof. Temporary files only; no application DB or API."""
from pathlib import Path
import itertools
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
import sqlite3
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
NOW = '2026-09-10T12:00:00.000Z'


class DataContract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='weiwan-schema-review-')
        self.db = sqlite3.connect(str(Path(self.tmp.name) / 'review.db'), isolation_level=None)
        self.db.execute('PRAGMA foreign_keys=ON')
        # DELETE journal: this test is not a WAL/driver compatibility certification.
        self.db.executescript((ROOT / 'm0.generated.sql').read_text())
        self.db.executescript((ROOT / 'm0.hardening.sql').read_text())
        self.ids = itertools.count(1)
        self.owner = self.add('local_profiles', display_name='A')
        self.other = self.add('local_profiles', display_name='B')
        self.story = self.add('story_drafts', title='Draft', settings='{}')
        self.binding = self.add('provider_binding_versions', binding_key='video', version_no=1,
                                provider_id='fixture', model_id='fixture-job', adapter_version='1',
                                capability_version='1', mode='job', credential_ref='fixture-ref',
                                parameters='{}', capabilities='{}')
        self.version = self.version_row(seal=True)
        self.exp = self.add('experiences', story_version_id=self.version,
                            provider_binding_version_id=self.binding,
                            budget_limit_micros=12500000, budget_currency='CNY')
        self.node = self.add('interaction_events', experience_id=self.exp,
                             experience_revision=1, kind='setup', options='[]')

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def test_initial_budget_survives_new_connection(self):
        with sqlite3.connect(str(Path(self.tmp.name) / 'review.db')) as reopened:
            self.assertEqual(reopened.execute(
                'SELECT budget_limit_micros,budget_currency FROM experiences WHERE id=?',
                (self.exp,)).fetchone(), (12500000, 'CNY'))

    def uid(self):
        # Deterministic UUIDv7-shaped test fixtures, not a production ID generator.
        return f'01992222-0000-7000-8000-{next(self.ids):012x}'

    def add(self, table, **data):
        cols = {r[1] for r in self.db.execute(f'PRAGMA table_info("{table}")')}
        data.setdefault('id', self.uid())
        data.setdefault('created_at', NOW)
        if 'owner_id' in cols:
            data.setdefault('owner_id', self.owner)
        if 'updated_at' in cols:
            data.setdefault('updated_at', NOW)
        names = list(data)
        quoted = ','.join('"' + name + '"' for name in names)
        self.db.execute(f'INSERT INTO "{table}" ({quoted}) VALUES ({",".join("?" for _ in names)})',
                        [data[k] for k in names])
        return data['id']

    def version_row(self, number=1, seal=False):
        key = self.add('story_versions', story_draft_id=self.story, version_no=number,
                       source_revision=number, title='Frozen', settings='{}')
        if seal:
            self.db.execute('UPDATE story_versions SET sealed_at=?,content_hash=? WHERE id=?', (NOW, 'a'*64, key))
        return key

    def asset(self, owner=None):
        return self.add('assets', owner_id=owner or self.owner, storage_key=self.uid(),
                        sha256='b'*64, mime_type='image/png', byte_size=100,
                        rights_declaration='local-fixture')

    def rejected(self, fn):
        with self.assertRaises(sqlite3.IntegrityError):
            fn()

    @contextmanager
    def gate(self, owner=None, connection=None, maintenance_purpose=None):
        db = connection or self.db
        db.execute('BEGIN')
        try:
            if maintenance_purpose not in (None, 'restore_profile', 'reconcile_operation', 'complete_gc'):
                raise ValueError('invalid_maintenance_scope')
            # Protocol fixture only: production requires a server-internal MaintenancePermit.
            suffix = ' AND deleted_at IS NULL' if maintenance_purpose is None else ''
            count = db.execute('UPDATE local_profiles SET write_epoch=write_epoch+1 WHERE id=?' + suffix,
                               (owner or self.owner,)).rowcount
            if count != 1:
                raise ValueError('owner_unavailable')
            yield db
            db.execute('COMMIT')
        except BaseException:
            db.execute('ROLLBACK')
            raise

    def make_slot(self, asset, key='cover', connection=None, rowid=None):
        with self.gate(connection=connection) as db:
            if not db.execute('SELECT id FROM story_drafts WHERE id=? AND owner_id=? AND deleted_at IS NULL',
                              (self.story, self.owner)).fetchone():
                raise ValueError('story_unavailable')
            if not db.execute("SELECT id FROM assets WHERE id=? AND owner_id=? AND deleted_at IS NULL AND status='ready'",
                              (asset, self.owner)).fetchone():
                raise ValueError('asset_unavailable')
            prior = db.execute('SELECT id,asset_id FROM story_draft_assets WHERE story_draft_id=? AND slot_key=?',
                               (self.story,key)).fetchall()
            if prior:
                if len(prior)==1 and prior[0][1]==asset:
                    return prior[0][0]
                raise ValueError('occupied_slot')
            result = rowid or self.uid()
            db.execute('INSERT INTO story_draft_assets(id,owner_id,story_draft_id,asset_id,slot_key,purpose,created_at) VALUES(?,?,?,?,?,?,?)',
                       (result,self.owner,self.story,asset,key,'cover',NOW))
            db.execute('UPDATE story_drafts SET revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND deleted_at IS NULL',
                       (NOW,self.story,self.owner))
            return result

    def update_title(self, expected, title):
        with self.gate() as db:
            count = db.execute('UPDATE story_drafts SET title=?,updated_at=?,revision=revision+1 WHERE id=? AND owner_id=? AND revision=? AND deleted_at IS NULL',
                               (title,NOW,self.story,self.owner,expected)).rowcount
            if count!=1:
                raise ValueError('revision_conflict')

    def delete_story(self, expected):
        with self.gate() as db:
            count=db.execute('UPDATE story_drafts SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=? AND owner_id=? AND revision=? AND deleted_at IS NULL',
                             (NOW,NOW,self.story,self.owner,expected)).rowcount
            if count!=1:
                raise ValueError('revision_conflict')

    def restore_asset(self, asset):
        with self.gate() as db:
            row = db.execute('SELECT status FROM assets WHERE id=? AND owner_id=?', (asset,self.owner)).fetchone()
            if row is None or row[0] in ('deleting','purged'):
                raise ValueError('asset_not_restorable')
            db.execute('UPDATE assets SET deleted_at=NULL,updated_at=?,revision=revision+1 WHERE id=?', (NOW,asset))

    def test_deleted_profile_blocks_business_not_controlled_reconcile(self):
        with self.gate() as db:
            db.execute('UPDATE local_profiles SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=?', (NOW,NOW,self.owner))
        with self.assertRaisesRegex(ValueError,'owner_unavailable'):
            with self.gate():
                pass
        with self.gate(maintenance_purpose='reconcile_operation') as db:
            self.assertIsNotNone(db.execute('SELECT deleted_at FROM local_profiles WHERE id=?',(self.owner,)).fetchone()[0])
        with self.assertRaisesRegex(ValueError,'invalid_maintenance_scope'):
            with self.gate(maintenance_purpose='generate_video'):
                pass

    def test_asset_association_changes_source_revision(self):
        asset=self.asset()
        self.make_slot(asset)
        revision=self.db.execute('SELECT revision FROM story_drafts WHERE id=?',(self.story,)).fetchone()[0]
        self.assertEqual(revision,2)
        new_version=self.version_row(revision,seal=True)
        self.assertNotEqual(new_version,self.version)
        self.assertEqual(self.db.execute('SELECT source_revision FROM story_versions WHERE id=?',(new_version,)).fetchone()[0],2)

    def test_restore_rejects_deleting_asset(self):
        asset=self.asset()
        with self.gate() as db:
            db.execute("UPDATE assets SET status='deleting',deleted_at=?,updated_at=?,revision=revision+1 WHERE id=?",(NOW,NOW,asset))
        with self.assertRaisesRegex(ValueError,'asset_not_restorable'):
            self.restore_asset(asset)

    def test_no_physical_foreign_keys(self):
        tables = [r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        self.assertEqual(len(tables),15)
        for table in tables:
            self.assertEqual(self.db.execute(f'PRAGMA foreign_key_list("{table}")').fetchall(),[])

    def test_no_referential_or_business_triggers(self):
        self.assertEqual(self.db.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall(),[])

    def test_exact_business_unique_register(self):
        actual={}
        for (table,) in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
            for row in self.db.execute(f'PRAGMA index_list("{table}")'):
                if row[2] and row[3]!='pk':
                    actual[row[1]]=tuple(r[2] for r in self.db.execute(f'PRAGMA index_info("{row[1]}")'))
        expected={
            'uq_command_receipts_owner_command':('owner_id','command_id'),
            'uq_story_versions_number':('story_draft_id','version_no'),
            'uq_story_versions_source':('story_draft_id','source_revision'),
            'uq_character_versions_number':('character_template_id','version_no'),
            'uq_character_versions_source':('character_template_id','source_revision'),
            'uq_story_draft_cast_slot':('story_draft_id','slot_key'),
            'uq_story_version_cast_slot':('story_version_id','slot_key'),
            'uq_story_draft_assets_slot':('story_draft_id','slot_key'),
            'uq_story_version_assets_slot':('story_version_id','slot_key'),
            'uq_provider_binding_versions_number':('owner_id','binding_key','version_no'),
            'uq_interaction_events_revision':('experience_id','experience_revision'),
            'uq_response_drafts_node':('owner_id','interaction_event_id'),
            'uq_assets_storage_key':('storage_key',),
        }
        self.assertEqual(actual,expected)

    def test_duplicate_names_titles_hashes_are_valid(self):
        self.add('story_drafts',title='Draft',settings='{}')
        self.add('character_templates',name='Same',settings='{}')
        self.add('character_templates',name='Same',settings='{}')
        self.asset(); self.asset()

    def test_same_source_revision_rejected(self):
        self.rejected(lambda: self.add('story_versions',story_draft_id=self.story,version_no=2,
                     source_revision=1,title='x',settings='{}'))

    def test_same_version_number_rejected(self):
        self.rejected(lambda: self.add('story_versions',story_draft_id=self.story,version_no=1,
                     source_revision=2,title='x',settings='{}'))

    def test_distinct_parent_can_use_same_version_number(self):
        parent=self.add('story_drafts',title='Draft',settings='{}')
        self.add('story_versions',story_draft_id=parent,version_no=1,source_revision=1,title='v',settings='{}')

    def test_primary_key_preserved(self):
        self.rejected(lambda: self.add('story_drafts',id=self.story,title='x',settings='{}'))

    def test_one_response_draft_per_owner_node(self):
        self.add('response_drafts',experience_id=self.exp,interaction_event_id=self.node)
        self.rejected(lambda: self.add('response_drafts',experience_id=self.exp,interaction_event_id=self.node))

    def test_database_does_not_fake_reference_protection(self):
        self.add('story_draft_assets',story_draft_id=self.uid(),asset_id=self.uid(),slot_key='orphan',purpose='cover')
        # This acceptance is intentional: the application, not a hidden trigger, validates references.

    def test_use_case_rejects_cross_owner_asset(self):
        with self.assertRaisesRegex(ValueError,'asset_unavailable'):
            self.make_slot(self.asset(self.other))

    def test_use_case_rejects_missing_asset(self):
        with self.assertRaisesRegex(ValueError,'asset_unavailable'):
            self.make_slot(self.uid())

    def test_create_slot_idempotent_semantic_reuse(self):
        asset=self.asset()
        first=self.make_slot(asset)
        self.assertEqual(first,self.make_slot(asset))

    def test_concurrent_create_same_slot(self):
        asset=self.asset()
        dbpath=str(Path(self.tmp.name)/'review.db')
        ids=[self.uid(),self.uid()]
        def run(key):
            db=sqlite3.connect(dbpath,isolation_level=None,timeout=2)
            try:
                return self.make_slot(asset,connection=db,rowid=key)
            finally:
                db.close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            result=list(pool.map(run,ids))
        self.assertEqual(result[0],result[1])
        self.assertEqual(self.db.execute('SELECT count(*) FROM story_draft_assets').fetchone()[0],1)

    def test_update_cas(self):
        self.update_title(1,'new')
        with self.assertRaisesRegex(ValueError,'revision_conflict'):
            self.update_title(1,'stale')
        self.assertEqual(self.db.execute('SELECT title FROM story_drafts WHERE id=?',(self.story,)).fetchone()[0],'new')

    def test_delete_is_soft_and_preserves_history(self):
        self.delete_story(1)
        self.assertIsNotNone(self.db.execute('SELECT deleted_at FROM story_drafts WHERE id=?',(self.story,)).fetchone()[0])
        self.assertEqual(self.db.execute('SELECT count(*) FROM story_versions WHERE id=?',(self.version,)).fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM story_drafts WHERE id=? AND deleted_at IS NULL',(self.story,)).fetchone()[0],0)

    def test_deleted_parent_cannot_accept_new_reference(self):
        asset=self.asset(); self.delete_story(1)
        with self.assertRaisesRegex(ValueError,'story_unavailable'):
            self.make_slot(asset)

    def test_deleting_asset_cannot_accept_new_reference(self):
        asset=self.asset()
        with self.gate() as db:
            db.execute("UPDATE assets SET status='deleting',revision=revision+1,updated_at=? WHERE id=?",(NOW,asset))
        with self.assertRaisesRegex(ValueError,'asset_unavailable'):
            self.make_slot(asset)

    def test_gate_rollback_preserves_business_and_counter(self):
        epoch=self.db.execute('SELECT write_epoch FROM local_profiles WHERE id=?',(self.owner,)).fetchone()[0]
        with self.assertRaises(ValueError):
            with self.gate() as db:
                db.execute('UPDATE story_drafts SET title=? WHERE id=?',('rollback',self.story))
                raise ValueError('abort')
        self.assertEqual(self.db.execute('SELECT title FROM story_drafts WHERE id=?',(self.story,)).fetchone()[0],'Draft')
        self.assertEqual(self.db.execute('SELECT write_epoch FROM local_profiles WHERE id=?',(self.owner,)).fetchone()[0],epoch)

    def test_command_receipt_unique_scope(self):
        key=self.uid()
        self.add('command_receipts',command_id=key,command_type='create',payload_hash='a'*64,response='{}')
        self.rejected(lambda:self.add('command_receipts',command_id=key,command_type='create',payload_hash='a'*64,response='{}'))
        self.add('command_receipts',owner_id=self.other,command_id=key,command_type='create',payload_hash='a'*64,response='{}')


if __name__=='__main__':
    print('V1.2 direct-SQL + protocol proof; SQLite',sqlite3.sqlite_version,'; not Prisma runtime/WAL certification',flush=True)
    unittest.main(verbosity=2)
