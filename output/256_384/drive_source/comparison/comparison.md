# Resolution fine-tune comparison

Status: **full_comparison**

Control: 256 px; candidate: 384 px. Delta is candidate minus control; metric deltas are percentage points (pp).

| Run | Completed / planned epochs | Best epoch | Initial accuracy | Initial Macro F1 |
| --- | --- | --- | --- | --- |
| control | 5 / 5 | 4 | 99.4349% | 96.0803% |
| candidate | 5 / 5 | 1 | 99.1646% | 94.2142% |

## Best including epoch 0

| Run | Epoch | Validation images | Accuracy | Macro F1 |
| --- | --- | --- | --- | --- |
| control | 4 | 4070 | 99.5823% | 96.2436% |
| candidate | 1 | 4070 | 99.5577% | 96.0005% |
| Delta | | | -0.0246 pp | -0.2432 pp |

### Per-class metrics

| Class | Run | Support | Precision | Recall | F1 |
| --- | --- | --- | --- | --- | --- |
| 0_고추탄저병 | control | 117 | 100.0000% | 99.1453% | 99.5708% |
| 0_고추탄저병 | candidate | 117 | 99.1453% | 99.1453% | 99.1453% |
| 0_고추탄저병 | delta | 0 | -0.8547 pp | +0.0000 pp | -0.4255 pp |
| 1_고추흰가루병 | control | 112 | 100.0000% | 100.0000% | 100.0000% |
| 1_고추흰가루병 | candidate | 112 | 97.3913% | 100.0000% | 98.6784% |
| 1_고추흰가루병 | delta | 0 | -2.6087 pp | +0.0000 pp | -1.3216 pp |
| 2_무검은무늬병 | control | 76 | 92.2078% | 93.4211% | 92.8105% |
| 2_무검은무늬병 | candidate | 76 | 89.4118% | 100.0000% | 94.4099% |
| 2_무검은무늬병 | delta | 0 | -2.7960 pp | +6.5789 pp | +1.5995 pp |
| 3_무노균병 | control | 24 | 85.0000% | 70.8333% | 77.2727% |
| 3_무노균병 | candidate | 24 | 100.0000% | 62.5000% | 76.9231% |
| 3_무노균병 | delta | 0 | +15.0000 pp | -8.3333 pp | -0.3497 pp |
| 4_배추검은썩음병 | control | 110 | 100.0000% | 99.0909% | 99.5434% |
| 4_배추검은썩음병 | candidate | 110 | 100.0000% | 98.1818% | 99.0826% |
| 4_배추검은썩음병 | delta | 0 | +0.0000 pp | -0.9091 pp | -0.4608 pp |
| 5_배추노균병 | control | 37 | 94.8718% | 100.0000% | 97.3684% |
| 5_배추노균병 | candidate | 37 | 92.5000% | 100.0000% | 96.1039% |
| 5_배추노균병 | delta | 0 | -2.3718 pp | +0.0000 pp | -1.2645 pp |
| 6_고추정상 | control | 1110 | 99.7305% | 100.0000% | 99.8650% |
| 6_고추정상 | candidate | 1110 | 100.0000% | 99.7297% | 99.8647% |
| 6_고추정상 | delta | 0 | +0.2695 pp | -0.2703 pp | -0.0004 pp |
| 7_무정상 | control | 1301 | 99.7698% | 99.9231% | 99.8464% |
| 7_무정상 | candidate | 1301 | 99.8465% | 100.0000% | 99.9232% |
| 7_무정상 | delta | 0 | +0.0767 pp | +0.0769 pp | +0.0768 pp |
| 8_배추정상 | control | 1183 | 100.0000% | 99.8309% | 99.9154% |
| 8_배추정상 | candidate | 1183 | 100.0000% | 99.7464% | 99.8730% |
| 8_배추정상 | delta | 0 | +0.0000 pp | -0.0845 pp | -0.0424 pp |

### Focused confusions

| Actual -> predicted | Control | Candidate | Delta |
| --- | --- | --- | --- |
| 3 -> 2 | 6 | 9 | +3 |
| 3 -> 8 | 0 | 0 | +0 |
| 2 -> 3 | 3 | 0 | -3 |

### Confusion matrix control

Rows: actual class; columns: predicted class.

| Actual / predicted | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 116 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| 1 | 0 | 112 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | 0 | 0 | 71 | 3 | 0 | 0 | 0 | 2 | 0 |
| 3 | 0 | 0 | 6 | 17 | 0 | 0 | 0 | 1 | 0 |
| 4 | 0 | 0 | 0 | 0 | 109 | 1 | 0 | 0 | 0 |
| 5 | 0 | 0 | 0 | 0 | 0 | 37 | 0 | 0 | 0 |
| 6 | 0 | 0 | 0 | 0 | 0 | 0 | 1110 | 0 | 0 |
| 7 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1300 | 0 |
| 8 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1181 |

### Confusion matrix candidate

Rows: actual class; columns: predicted class.

| Actual / predicted | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 0 | 112 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | 0 | 0 | 76 | 0 | 0 | 0 | 0 | 0 | 0 |
| 3 | 0 | 0 | 9 | 15 | 0 | 0 | 0 | 0 | 0 |
| 4 | 0 | 0 | 0 | 0 | 108 | 2 | 0 | 0 | 0 |
| 5 | 0 | 0 | 0 | 0 | 0 | 37 | 0 | 0 | 0 |
| 6 | 1 | 2 | 0 | 0 | 0 | 0 | 1107 | 0 | 0 |
| 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1301 | 0 |
| 8 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 2 | 1180 |

### Confusion matrix delta

Rows: actual class; columns: predicted class.

| Actual / predicted | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 1 | 0 | 0 | 0 | 0 | -1 | 0 | 0 |
| 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | 0 | 0 | 5 | -3 | 0 | 0 | 0 | -2 | 0 |
| 3 | 0 | 0 | 3 | -2 | 0 | 0 | 0 | -1 | 0 |
| 4 | 0 | 0 | 0 | 0 | -1 | 1 | 0 | 0 | 0 |
| 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 6 | 1 | 2 | 0 | 0 | 0 | 0 | -3 | 0 | 0 |
| 7 | 0 | 0 | 0 | 0 | 0 | 0 | -1 | 1 | 0 |
| 8 | 0 | 0 | 0 | 0 | 0 | 0 | -1 | 2 | -1 |

## Fixed epoch 5

| Run | Epoch | Validation images | Accuracy | Macro F1 |
| --- | --- | --- | --- | --- |
| control | 5 | 4070 | 99.5086% | 95.5091% |
| candidate | 5 | 4070 | 99.5577% | 95.1798% |
| Delta | | | +0.0491 pp | -0.3293 pp |

### Per-class metrics

| Class | Run | Support | Precision | Recall | F1 |
| --- | --- | --- | --- | --- | --- |
| 0_고추탄저병 | control | 117 | 100.0000% | 99.1453% | 99.5708% |
| 0_고추탄저병 | candidate | 117 | 100.0000% | 100.0000% | 100.0000% |
| 0_고추탄저병 | delta | 0 | +0.0000 pp | +0.8547 pp | +0.4292 pp |
| 1_고추흰가루병 | control | 112 | 100.0000% | 100.0000% | 100.0000% |
| 1_고추흰가루병 | candidate | 112 | 99.1150% | 100.0000% | 99.5556% |
| 1_고추흰가루병 | delta | 0 | -0.8850 pp | +0.0000 pp | -0.4444 pp |
| 2_무검은무늬병 | control | 76 | 92.1053% | 92.1053% | 92.1053% |
| 2_무검은무늬병 | candidate | 76 | 88.7500% | 93.4211% | 91.0256% |
| 2_무검은무늬병 | delta | 0 | -3.3553 pp | +1.3158 pp | -1.0796 pp |
| 3_무노균병 | control | 24 | 77.2727% | 70.8333% | 73.9130% |
| 3_무노균병 | candidate | 24 | 83.3333% | 62.5000% | 71.4286% |
| 3_무노균병 | delta | 0 | +6.0606 pp | -8.3333 pp | -2.4845 pp |
| 4_배추검은썩음병 | control | 110 | 100.0000% | 99.0909% | 99.5434% |
| 4_배추검은썩음병 | candidate | 110 | 99.0826% | 98.1818% | 98.6301% |
| 4_배추검은썩음병 | delta | 0 | -0.9174 pp | -0.9091 pp | -0.9132 pp |
| 5_배추노균병 | control | 37 | 90.2439% | 100.0000% | 94.8718% |
| 5_배추노균병 | candidate | 37 | 92.5000% | 100.0000% | 96.1039% |
| 5_배추노균병 | delta | 0 | +2.2561 pp | +0.0000 pp | +1.2321 pp |
| 6_고추정상 | control | 1110 | 99.6409% | 100.0000% | 99.8201% |
| 6_고추정상 | candidate | 1110 | 100.0000% | 99.9099% | 99.9549% |
| 6_고추정상 | delta | 0 | +0.3591 pp | -0.0901 pp | +0.1348 pp |
| 7_무정상 | control | 1301 | 99.9231% | 99.8463% | 99.8847% |
| 7_무정상 | candidate | 1301 | 99.9232% | 100.0000% | 99.9616% |
| 7_무정상 | delta | 0 | +0.0001 pp | +0.1537 pp | +0.0769 pp |
| 8_배추정상 | control | 1183 | 100.0000% | 99.7464% | 99.8730% |
| 8_배추정상 | candidate | 1183 | 100.0000% | 99.9155% | 99.9577% |
| 8_배추정상 | delta | 0 | +0.0000 pp | +0.1691 pp | +0.0847 pp |

### Focused confusions

| Actual -> predicted | Control | Candidate | Delta |
| --- | --- | --- | --- |
| 3 -> 2 | 6 | 9 | +3 |
| 3 -> 8 | 0 | 0 | +0 |
| 2 -> 3 | 5 | 3 | -2 |

### Confusion matrix control

Rows: actual class; columns: predicted class.

| Actual / predicted | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 116 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| 1 | 0 | 112 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | 0 | 0 | 70 | 5 | 0 | 1 | 0 | 0 | 0 |
| 3 | 0 | 0 | 6 | 17 | 0 | 0 | 0 | 1 | 0 |
| 4 | 0 | 0 | 0 | 0 | 109 | 1 | 0 | 0 | 0 |
| 5 | 0 | 0 | 0 | 0 | 0 | 37 | 0 | 0 | 0 |
| 6 | 0 | 0 | 0 | 0 | 0 | 0 | 1110 | 0 | 0 |
| 7 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1299 | 0 |
| 8 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 1180 |

### Confusion matrix candidate

Rows: actual class; columns: predicted class.

| Actual / predicted | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 117 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 0 | 112 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | 0 | 0 | 71 | 3 | 1 | 0 | 0 | 1 | 0 |
| 3 | 0 | 0 | 9 | 15 | 0 | 0 | 0 | 0 | 0 |
| 4 | 0 | 0 | 0 | 0 | 108 | 2 | 0 | 0 | 0 |
| 5 | 0 | 0 | 0 | 0 | 0 | 37 | 0 | 0 | 0 |
| 6 | 0 | 1 | 0 | 0 | 0 | 0 | 1109 | 0 | 0 |
| 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1301 | 0 |
| 8 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1182 |

### Confusion matrix delta

Rows: actual class; columns: predicted class.

| Actual / predicted | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 1 | 0 | 0 | 0 | 0 | 0 | -1 | 0 | 0 |
| 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | 0 | 0 | 1 | -2 | 1 | -1 | 0 | 1 | 0 |
| 3 | 0 | 0 | 3 | -2 | 0 | 0 | 0 | -1 | 0 |
| 4 | 0 | 0 | 0 | 0 | -1 | 1 | 0 | 0 | 0 |
| 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 6 | 0 | 1 | 0 | 0 | 0 | 0 | -1 | 0 | 0 |
| 7 | 0 | 0 | 0 | 0 | 0 | 0 | -2 | 2 | 0 |
| 8 | 0 | 0 | 0 | 0 | 0 | -1 | -1 | 0 | 2 |

## Original baseline reference

Original 256 px best epoch: 3; validation images: 4070; accuracy: 99.4349%; Macro F1: 96.0803%.

Source checkpoint SHA256 independently verified: True

| Class | Support | Precision | Recall | F1 |
| --- | --- | --- | --- | --- |
| 0_고추탄저병 | 117 | 100.0000% | 100.0000% | 100.0000% |
| 1_고추흰가루병 | 112 | 99.1150% | 100.0000% | 99.5556% |
| 2_무검은무늬병 | 76 | 95.8333% | 90.7895% | 93.2432% |
| 3_무노균병 | 24 | 76.0000% | 79.1667% | 77.5510% |
| 4_배추검은썩음병 | 110 | 100.0000% | 98.1818% | 99.0826% |
| 5_배추노균병 | 37 | 92.5000% | 100.0000% | 96.1039% |
| 6_고추정상 | 1110 | 99.3728% | 99.9099% | 99.6406% |
| 7_무정상 | 1301 | 100.0000% | 99.7694% | 99.8846% |
| 8_배추정상 | 1183 | 99.7460% | 99.5773% | 99.6616% |

| Actual -> predicted | Count |
| --- | --- |
| 3 -> 2 | 3 |
| 3 -> 8 | 2 |
| 2 -> 3 | 6 |

### Confusion matrix original reference

Rows: actual class; columns: predicted class.

| Actual / predicted | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 117 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 0 | 112 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | 0 | 0 | 69 | 6 | 0 | 0 | 0 | 0 | 1 |
| 3 | 0 | 0 | 3 | 19 | 0 | 0 | 0 | 0 | 2 |
| 4 | 0 | 0 | 0 | 0 | 108 | 1 | 1 | 0 | 0 |
| 5 | 0 | 0 | 0 | 0 | 0 | 37 | 0 | 0 | 0 |
| 6 | 0 | 1 | 0 | 0 | 0 | 0 | 1109 | 0 | 0 |
| 7 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 1298 | 0 |
| 8 | 0 | 0 | 0 | 0 | 0 | 2 | 3 | 0 | 1178 |

## Run provenance

```json
{
  "control": {
    "arch": "resnet50",
    "epochs": 5,
    "batch_size": 16,
    "img_size": 256,
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
    "smoke_per_class": 0,
    "train_images": 32513,
    "val_images": 4070,
    "num_workers": 2,
    "init_checkpoint_sha256": "4ef9988d85259b776eaf8fa5824edd2c28b08371e0c19296221e107b670d0060",
    "init_checkpoint_epoch": 3,
    "init_checkpoint_img_size": 256
  },
  "candidate": {
    "arch": "resnet50",
    "epochs": 5,
    "batch_size": 16,
    "img_size": 384,
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
    "smoke_per_class": 0,
    "train_images": 32513,
    "val_images": 4070,
    "num_workers": 2,
    "init_checkpoint_sha256": "4ef9988d85259b776eaf8fa5824edd2c28b08371e0c19296221e107b670d0060",
    "init_checkpoint_epoch": 3,
    "init_checkpoint_img_size": 256
  }
}
```

## Recorded environment

Recorded fields match: True

```json
{
  "control": {
    "torch": "2.11.0+cu130",
    "device": "cuda",
    "gpu": "Tesla T4"
  },
  "candidate": {
    "torch": "2.11.0+cu130",
    "device": "cuda",
    "gpu": "Tesla T4"
  }
}
```

## Limitations

- This is one validation split and seed; improvement is not evidence of generalization to new data.
- Best includes epoch 0 evaluated independently at each resolution; epoch 0 can remain best after five training epochs.
- Best checkpoints can come from different epochs. Fixed epoch 5 compares equal completed training duration.
- The original baseline is a source reference; only the paired 256/384 fine-tunes isolate resolution.
- Only recorded environment fields are compared; matching metadata does not prove identical software or hardware.
- Class 3 validation support is 24; one image changes recall by 4.17 percentage points.

