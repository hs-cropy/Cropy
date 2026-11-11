"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Switch } from "@/components/Switch";
import { CAPTURE_PATH } from "@/components/diagnosis/DiagnosisSession";
import { PROMPT_HOME, PROMPT_VOICE_ON } from "../lib/prompts";
import { cancelSpeech, isSpeechSupported, speak } from "../lib/speech";
import { setVoiceEnabled, useVoiceSetting } from "../hooks/useVoiceSetting";

interface VoiceToggleProps {
	/** 배치용 클래스 (폭 등). 스위치의 모양은 Switch가 정한다 */
	className?: string;
}

/**
 * 음성 안내 켜기/끄기 (06_웹앱_기능명세서 공통 컴포넌트 VoiceGuide).
 *
 * 미지원 브라우저에서도 토글은 표시하되 비활성화하고 안내한다.
 */
export function VoiceGuideToggle({ className }: VoiceToggleProps) {
	const enabled = useVoiceSetting();
	const pathname = usePathname();
	const [supported, setSupported] = useState(true);

	useEffect(() => {
		setSupported(isSpeechSupported());
	}, []);

	const change = (next: boolean) => {
		if (!supported) return;

		setVoiceEnabled(next);

		if (next) {
			speak(
				pathname === CAPTURE_PATH
					? [PROMPT_VOICE_ON, PROMPT_HOME]
					: PROMPT_VOICE_ON,
			);
		} else {
			cancelSpeech();
		}
	};

	return (
		<div
			className="relative shrink-0"
			title={
				supported
					? undefined
					: "이 브라우저에서는 음성 안내를 지원하지 않아요."
			}
		>
			<Switch
				checked={supported && enabled}
				onCheckedChange={change}
				aria-label="음성 안내"
				aria-describedby={
					supported ? undefined : "voice-guide-unsupported"
				}
				disabled={!supported}
				className={className}
			>
				<span className="md:hidden">음성</span>
				<span className="hidden md:inline">음성 안내</span>
			</Switch>

			{!supported && (
				<span id="voice-guide-unsupported" className="sr-only">
					이 브라우저에서는 음성 안내를 지원하지 않아요.
				</span>
			)}
		</div>
	);
}