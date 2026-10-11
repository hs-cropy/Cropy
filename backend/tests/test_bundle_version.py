from scripts.export_browser_model import bundle_version


def test_bundle_identity_covers_content_policy_and_preprocessing():
    base = {"sha256": "same-model", "diseases": [{"description": "old"}], "policy": {"threshold": .5}, "preprocessing_version": "one"}
    version = bundle_version(base)
    assert version == bundle_version(dict(reversed(list(base.items()))))
    for update in ({"diseases": [{"description": "new"}]}, {"policy": {"threshold": .6}}, {"preprocessing_version": "two"}):
        assert bundle_version({**base, **update}) != version
