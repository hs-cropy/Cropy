# Resolution fine-tune comparison

Status: **smoke**

Control: 64 px; candidate: 96 px. Delta is candidate minus control; metric deltas are percentage points (pp).

| Run | Completed / planned epochs | Best epoch | Initial accuracy | Initial Macro F1 |
| --- | --- | --- | --- | --- |
| control | 5 / 5 | 2 | 5.5556% | 1.7094% |
| candidate | 5 / 5 | 2 | 0.0000% | 0.0000% |

## Best including epoch 0

| Run | Epoch | Validation images | Accuracy | Macro F1 |
| --- | --- | --- | --- | --- |
| control | 2 | 18 | 5.5556% | 1.8519% |
| candidate | 2 | 18 | 16.6667% | 7.1605% |
| Delta | | | +11.1111 pp | +5.3086 pp |

### Per-class metrics

| Class | Run | Support | Precision | Recall | F1 |
| --- | --- | --- | --- | --- | --- |
| 0_고추탄저병 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 0_고추탄저병 | candidate | 2 | 0.0000% | 0.0000% | 0.0000% |
| 0_고추탄저병 | delta | 0 | +0.0000 pp | +0.0000 pp | +0.0000 pp |
| 1_고추흰가루병 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 1_고추흰가루병 | candidate | 2 | 0.0000% | 0.0000% | 0.0000% |
| 1_고추흰가루병 | delta | 0 | +0.0000 pp | +0.0000 pp | +0.0000 pp |
| 2_무검은무늬병 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 2_무검은무늬병 | candidate | 2 | 0.0000% | 0.0000% | 0.0000% |
| 2_무검은무늬병 | delta | 0 | +0.0000 pp | +0.0000 pp | +0.0000 pp |
| 3_무노균병 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 3_무노균병 | candidate | 2 | 28.5714% | 100.0000% | 44.4444% |
| 3_무노균병 | delta | 0 | +28.5714 pp | +100.0000 pp | +44.4444 pp |
| 4_배추검은썩음병 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 4_배추검은썩음병 | candidate | 2 | 0.0000% | 0.0000% | 0.0000% |
| 4_배추검은썩음병 | delta | 0 | +0.0000 pp | +0.0000 pp | +0.0000 pp |
| 5_배추노균병 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 5_배추노균병 | candidate | 2 | 0.0000% | 0.0000% | 0.0000% |
| 5_배추노균병 | delta | 0 | +0.0000 pp | +0.0000 pp | +0.0000 pp |
| 6_고추정상 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 6_고추정상 | candidate | 2 | 0.0000% | 0.0000% | 0.0000% |
| 6_고추정상 | delta | 0 | +0.0000 pp | +0.0000 pp | +0.0000 pp |
| 7_무정상 | control | 2 | 10.0000% | 50.0000% | 16.6667% |
| 7_무정상 | candidate | 2 | 12.5000% | 50.0000% | 20.0000% |
| 7_무정상 | delta | 0 | +2.5000 pp | +0.0000 pp | +3.3333 pp |
| 8_배추정상 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 8_배추정상 | candidate | 2 | 0.0000% | 0.0000% | 0.0000% |
| 8_배추정상 | delta | 0 | +0.0000 pp | +0.0000 pp | +0.0000 pp |

### Focused confusions

| Actual -> predicted | Control | Candidate | Delta |
| --- | --- | --- | --- |
| 3 -> 2 | 0 | 0 | +0 |
| 3 -> 8 | 0 | 0 | +0 |
| 2 -> 3 | 0 | 0 | +0 |

### Confusion matrix control

Rows: actual class; columns: predicted class.

| Actual / predicted | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| 3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| 4 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 5 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| 7 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 8 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |

### Confusion matrix candidate

Rows: actual class; columns: predicted class.

| Actual / predicted | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| 3 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |
| 4 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 5 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| 7 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 8 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |

### Confusion matrix delta

Rows: actual class; columns: predicted class.

| Actual / predicted | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | -1 | 0 |
| 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 3 | -1 | 0 | 0 | 2 | 0 | 0 | 0 | -1 | 0 |
| 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 8 | 1 | 0 | 0 | -1 | 0 | 0 | 0 | 0 | 0 |

## Fixed epoch 5

| Run | Epoch | Validation images | Accuracy | Macro F1 |
| --- | --- | --- | --- | --- |
| control | 5 | 18 | 5.5556% | 1.8519% |
| candidate | 5 | 18 | 11.1111% | 5.0000% |
| Delta | | | +5.5556 pp | +3.1481 pp |

### Per-class metrics

| Class | Run | Support | Precision | Recall | F1 |
| --- | --- | --- | --- | --- | --- |
| 0_고추탄저병 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 0_고추탄저병 | candidate | 2 | 0.0000% | 0.0000% | 0.0000% |
| 0_고추탄저병 | delta | 0 | +0.0000 pp | +0.0000 pp | +0.0000 pp |
| 1_고추흰가루병 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 1_고추흰가루병 | candidate | 2 | 0.0000% | 0.0000% | 0.0000% |
| 1_고추흰가루병 | delta | 0 | +0.0000 pp | +0.0000 pp | +0.0000 pp |
| 2_무검은무늬병 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 2_무검은무늬병 | candidate | 2 | 0.0000% | 0.0000% | 0.0000% |
| 2_무검은무늬병 | delta | 0 | +0.0000 pp | +0.0000 pp | +0.0000 pp |
| 3_무노균병 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 3_무노균병 | candidate | 2 | 16.6667% | 50.0000% | 25.0000% |
| 3_무노균병 | delta | 0 | +16.6667 pp | +50.0000 pp | +25.0000 pp |
| 4_배추검은썩음병 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 4_배추검은썩음병 | candidate | 2 | 0.0000% | 0.0000% | 0.0000% |
| 4_배추검은썩음병 | delta | 0 | +0.0000 pp | +0.0000 pp | +0.0000 pp |
| 5_배추노균병 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 5_배추노균병 | candidate | 2 | 0.0000% | 0.0000% | 0.0000% |
| 5_배추노균병 | delta | 0 | +0.0000 pp | +0.0000 pp | +0.0000 pp |
| 6_고추정상 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 6_고추정상 | candidate | 2 | 0.0000% | 0.0000% | 0.0000% |
| 6_고추정상 | delta | 0 | +0.0000 pp | +0.0000 pp | +0.0000 pp |
| 7_무정상 | control | 2 | 10.0000% | 50.0000% | 16.6667% |
| 7_무정상 | candidate | 2 | 12.5000% | 50.0000% | 20.0000% |
| 7_무정상 | delta | 0 | +2.5000 pp | +0.0000 pp | +3.3333 pp |
| 8_배추정상 | control | 2 | 0.0000% | 0.0000% | 0.0000% |
| 8_배추정상 | candidate | 2 | 0.0000% | 0.0000% | 0.0000% |
| 8_배추정상 | delta | 0 | +0.0000 pp | +0.0000 pp | +0.0000 pp |

### Focused confusions

| Actual -> predicted | Control | Candidate | Delta |
| --- | --- | --- | --- |
| 3 -> 2 | 0 | 0 | +0 |
| 3 -> 8 | 0 | 0 | +0 |
| 2 -> 3 | 0 | 0 | +0 |

### Confusion matrix control

Rows: actual class; columns: predicted class.

| Actual / predicted | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| 3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| 4 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 5 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| 7 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 8 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |

### Confusion matrix candidate

Rows: actual class; columns: predicted class.

| Actual / predicted | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| 3 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 4 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 5 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |
| 6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| 7 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| 8 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |

### Confusion matrix delta

Rows: actual class; columns: predicted class.

| Actual / predicted | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | -1 | 0 |
| 1 | 0 | 0 | 0 | 1 | -1 | 0 | 0 | 0 | 0 |
| 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 3 | -1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 5 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | -1 | 0 |
| 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 7 | 0 | 1 | 0 | -1 | 0 | 0 | 0 | 0 | 0 |
| 8 | 1 | 0 | 0 | -1 | 0 | 0 | 0 | 0 | 0 |

## Original baseline reference

Not supplied.

## Run provenance

```json
{
  "control": {
    "arch": "resnet18",
    "epochs": 5,
    "batch_size": 9,
    "img_size": 64,
    "train_geometry": "random_crop",
    "seed": 42,
    "lr": 1e-05,
    "balanced_sampler": true,
    "selection": "highest validation macro_f1; earliest tie",
    "manifest_sha256": "1d8924f17fa8cc02f69607a14a60e879301e24e2fd74a8a01792b491d8701b34",
    "classes": [
      "0_고추탄저병",
      "1_고추흰가루병",
      "2_무검은무늬병",
      "3_무노균병",
      "4_배추검은썩음병",
      "5_배추노균병",
      "6_고추정상",
      "7_무정상",
      "8_배추정상"
    ],
    "smoke_per_class": 2,
    "train_images": 18,
    "val_images": 18,
    "num_workers": 0,
    "init_checkpoint_sha256": "4a95f4a537b63db26febe0013a182e729a3fb66ee9e07bf9ca13f5db0afff465",
    "init_checkpoint_epoch": 1,
    "init_checkpoint_img_size": 64
  },
  "candidate": {
    "arch": "resnet18",
    "epochs": 5,
    "batch_size": 9,
    "img_size": 96,
    "train_geometry": "random_crop",
    "seed": 42,
    "lr": 1e-05,
    "balanced_sampler": true,
    "selection": "highest validation macro_f1; earliest tie",
    "manifest_sha256": "1d8924f17fa8cc02f69607a14a60e879301e24e2fd74a8a01792b491d8701b34",
    "classes": [
      "0_고추탄저병",
      "1_고추흰가루병",
      "2_무검은무늬병",
      "3_무노균병",
      "4_배추검은썩음병",
      "5_배추노균병",
      "6_고추정상",
      "7_무정상",
      "8_배추정상"
    ],
    "smoke_per_class": 2,
    "train_images": 18,
    "val_images": 18,
    "num_workers": 0,
    "init_checkpoint_sha256": "4a95f4a537b63db26febe0013a182e729a3fb66ee9e07bf9ca13f5db0afff465",
    "init_checkpoint_epoch": 1,
    "init_checkpoint_img_size": 64
  }
}
```

## Recorded environment

Recorded fields match: True

```json
{
  "control": {
    "torch": "2.12.1+cpu",
    "device": "cpu",
    "gpu": null
  },
  "candidate": {
    "torch": "2.12.1+cpu",
    "device": "cpu",
    "gpu": null
  }
}
```

## Limitations

- SMOKE RUN: pipeline check only; do not interpret as full-run performance.
- This is one validation split and seed; improvement is not evidence of generalization to new data.
- Best includes epoch 0 evaluated independently at each resolution; epoch 0 can remain best after five training epochs.
- Best checkpoints can come from different epochs. Fixed epoch 5 compares equal completed training duration.
- The original baseline is a source reference; only the paired 256/384 fine-tunes isolate resolution.
- Only recorded environment fields are compared; matching metadata does not prove identical software or hardware.
- Class 3 validation support is 2; one image changes recall by 50.00 percentage points.
- Both paired runs record the same source SHA256; the original checkpoint file was not available for independent hash verification.
