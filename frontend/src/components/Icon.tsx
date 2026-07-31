import {
  Activity,
  Archive,
  AudioLines,
  AudioWaveform,
  SquarePlay,
  Check,
  CircleAlert,
  CircleCheck,
  CircleCheckBig,
  CircleHelp,
  CircleUserRound,
  CloudUpload,
  Download,
  Drum,
  FileAudio,
  FileAudio2,
  Fingerprint,
  FolderOpen,
  Guitar,
  Info,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  Mail,
  Mic2,
  Music,
  Music2,
  Pause,
  Piano,
  Play,
  Plus,
  RefreshCw,
  Replace,
  RotateCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UploadCloud,
  UserRound,
  Volume2,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
  activity: Activity,
  archive: Archive,
  "audio-lines": AudioLines,
  "audio-waveform": AudioWaveform,
  check: Check,
  "circle-alert": CircleAlert,
  "circle-check": CircleCheck,
  "circle-check-big": CircleCheckBig,
  "circle-user-round": CircleUserRound,
  "cloud-upload": CloudUpload,
  download: Download,
  drum: Drum,
  "file-audio": FileAudio,
  "file-audio-2": FileAudio2,
  fingerprint: Fingerprint,
  "folder-open": FolderOpen,
  guitar: Guitar,
  info: Info,
  "loader-circle": LoaderCircle,
  "lock-keyhole": LockKeyhole,
  "log-in": LogIn,
  "log-out": LogOut,
  mail: Mail,
  "mic-2": Mic2,
  music: Music,
  "music-2": Music2,
  pause: Pause,
  piano: Piano,
  play: Play,
  plus: Plus,
  "refresh-cw": RefreshCw,
  replace: Replace,
  "rotate-cw": RotateCw,
  "shield-check": ShieldCheck,
  "sliders-horizontal": SlidersHorizontal,
  sparkles: Sparkles,
  "trash-2": Trash2,
  "upload-cloud": UploadCloud,
  "user-round": UserRound,
  "volume-2": Volume2,
  "wifi-off": WifiOff,
  x: X,
  youtube: SquarePlay,
};

interface IconProps {
  name: string;
  width?: number;
  className?: string;
}

export function Icon({ name, width, className }: IconProps) {
  const LucideIconComponent = icons[name] ?? CircleHelp;

  return (
    <LucideIconComponent
      className={["iconify", className].filter(Boolean).join(" ")}
      size={width ?? "1em"}
      aria-hidden="true"
      focusable="false"
    />
  );
}
