interface VoiceBubbleProps {
  role: "user" | "assistant";
  text: string;
}

export function VoiceBubble({
  role,
  text,
}: VoiceBubbleProps) {
  const isUser = role === "user";

  return (
    <div
      className={`flex w-full ${
        isUser ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`max-w-[90%] rounded-2xl px-4 py-3 text-left ${
          isUser
            ? "bg-[#E5F4E6] text-[#212A23]"
            : "border border-[#E2EBE4] bg-white text-[#212A23]"
        }`}
      >
        <p
          className={`mb-1 text-xs font-semibold ${
            isUser ? "text-[#1F6B3B]" : "text-[#25864F]"
          }`}
        >
          {isUser ? "내 말" : "크로피"}
        </p>
        <p className="text-sm leading-relaxed">{text}</p>
      </div>
    </div>
  );
}