from concurrent.futures import ThreadPoolExecutor

import pytest

from app import main, settings


def test_parallel_profile_updates_preserve_every_profile():
    with ThreadPoolExecutor(max_workers=8) as pool:
        ids = list(pool.map(lambda i: settings.add_profile('test', f'Profile {i}', {'api_key': f'fake-{i}'}), range(32)))
    store = settings._load_profile_store()
    assert {item['id'] for item in store['test']['profiles']} == set(ids)
    assert len(store['test']['profiles']) == 32


def test_deleting_default_clears_the_default_reference():
    profile = settings.add_profile('test', 'Temporary', {'api_key': 'fake'})
    assert settings.set_default_profile('test', profile)
    settings.delete_profile('test', profile)
    assert settings.get_default_profile() is None
    assert settings.get_credential('test', 'api_key') is None


def test_corrupt_store_is_never_replaced_by_migration_or_addition():
    settings.PROFILES_PATH.write_text('{broken', encoding='utf-8')
    for operation in [main._ensure_profiles_migrated, lambda: settings.add_profile('test', 'New', {})]:
        with pytest.raises(ValueError):
            operation()
        assert settings.PROFILES_PATH.read_text(encoding='utf-8') == '{broken'


def test_first_configuration_is_default_and_later_additions_preserve_it():
    first = settings.add_profile('test', '', {'api_key': 'fake', 'model': 'model-a'}, default_name='Service')
    settings.add_profile('test', 'Team', {'api_key': 'fake-two'})
    assert settings.get_default_profile() == {'provider_id': 'test', 'profile_id': first}
    assert settings._load_profile_store()['test']['profiles'][0]['name'] == 'Service · model-a'
