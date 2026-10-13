"""Guard the crop ablation's pixels, RNG use, and legacy resume contract."""

import sys
from pathlib import Path

import pytest
import torch
from PIL import Image, ImageDraw
from torchvision import transforms

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import train
import train_full_colab


@pytest.fixture
def multicolor_image():
    image = Image.new("RGB", (96, 64))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 47, 31), fill=(255, 0, 0))
    draw.rectangle((48, 0, 95, 31), fill=(0, 255, 0))
    draw.rectangle((0, 32, 47, 63), fill=(0, 0, 255))
    draw.rectangle((48, 32, 95, 63), fill=(255, 255, 0))
    draw.rectangle((37, 24, 58, 39), fill=(255, 255, 255))
    return image


@pytest.mark.parametrize("geometry", [None, "random_crop", "full_resize"])
@pytest.mark.parametrize("seed", [42, 917])
def test_training_pixels_and_rng_match_the_original_augmentations(multicolor_image, geometry, seed):
    # Catches changed augmentation order/parameters or extra RNG use in either branch.
    expected = transforms.Compose([
        transforms.Resize((64, 64)) if geometry == "full_resize"
        else transforms.RandomResizedCrop(64, scale=(0.7, 1.0)),
        transforms.RandomHorizontalFlip(),
        transforms.RandomRotation(15),
        transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.2),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    with torch.random.fork_rng(devices=[]):
        torch.manual_seed(seed)
        expected_pixels = expected(multicolor_image)
        expected_rng = torch.get_rng_state()
        torch.manual_seed(seed)
        actual, _ = (train.get_transforms(64) if geometry is None
                     else train.get_transforms(64, train_geometry=geometry))
        assert torch.equal(actual(multicolor_image), expected_pixels)
        assert torch.equal(torch.get_rng_state(), expected_rng)


def test_full_resize_preserves_the_whole_non_square_image_without_random_sampling(multicolor_image):
    # A crop or aspect-preserving resize would lose corners or the requested square size.
    actual, _ = train.get_transforms(32, train_geometry="full_resize")
    with torch.random.fork_rng(devices=[]):
        torch.manual_seed(42)
        before = torch.get_rng_state()
        resized = actual.transforms[0](multicolor_image)
        assert torch.equal(torch.get_rng_state(), before)
    assert resized.size == (32, 32)
    assert [resized.getpixel(point) for point in [(0, 0), (31, 0), (0, 31), (31, 31), (16, 16)]] == [
        (255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0), (255, 255, 255),
    ]


@pytest.mark.parametrize("geometry", [None, "random_crop", "full_resize"])
def test_validation_pixels_remain_unchanged(multicolor_image, geometry):
    # Catches accidentally applying the ablation or training randomness to validation.
    expected = transforms.Compose([
        transforms.Resize((256, 256)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])(multicolor_image)
    _, actual = (train.get_transforms(256) if geometry is None
                 else train.get_transforms(256, train_geometry=geometry))
    with torch.random.fork_rng(devices=[]):
        torch.manual_seed(42)
        before = torch.get_rng_state()
        assert torch.equal(actual(multicolor_image), expected)
        assert torch.equal(torch.get_rng_state(), before)


def test_unknown_geometry_is_rejected():
    # A typo must not silently select an unintended experiment.
    with pytest.raises(ValueError, match="train_geometry"):
        train.get_transforms(256, train_geometry="typo")


def test_legacy_config_compares_as_crop_without_modifying_the_original():
    # Catches breaking existing resume files or mutating their loaded configuration.
    legacy = {"arch": "resnet50", "img_size": 256, "seed": 42}
    normalized = train_full_colab._config_with_train_geometry(legacy)
    assert normalized == {"arch": "resnet50", "img_size": 256, "seed": 42, "train_geometry": "random_crop"}
    assert legacy == {"arch": "resnet50", "img_size": 256, "seed": 42}


def test_config_comparison_keeps_geometry_and_other_setting_mismatches():
    # Catches normalizing away a resize/crop difference or other resume safeguards.
    crop = {"img_size": 256, "train_geometry": "random_crop"}
    resized = {"img_size": 256, "train_geometry": "full_resize"}
    other_size = {"img_size": 224, "train_geometry": "random_crop"}
    normalize = train_full_colab._config_with_train_geometry
    assert normalize(crop) == {"img_size": 256, "train_geometry": "random_crop"}
    assert normalize(resized) == {"img_size": 256, "train_geometry": "full_resize"}
    assert normalize(crop) != normalize(resized)
    assert normalize(crop) != normalize(other_size)
