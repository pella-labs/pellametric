// @bematist/ui — shared UI primitives for the Bematist dashboard.
// Dark mode default, WCAG AA target, every chart has a table toggle.

export { brand } from "../brand.config";
export type { BrandColor } from "../brand.config";

export { cn } from "./lib/cn";

// Components
export { Badge, type BadgeProps } from "./components/Badge";
export { Button, buttonVariants, type ButtonProps } from "./components/Button";
export {
  Card,
  CardHeader,
  CardTitle,
  CardValue,
} from "./components/Card";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
} from "./components/Dialog";
export { Input, Textarea } from "./components/Input";
export { Skeleton } from "./components/Skeleton";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "./components/Tooltip";

// Charts
export {
  AreaChart,
  type AreaChartDatum,
  type AreaChartFormat,
  type AreaChartProps,
} from "./charts/AreaChart";
export { ChartTableToggle } from "./charts/ChartTableToggle";
export {
  ScatterChart,
  type ScatterChartProps,
  type ScatterDatum,
} from "./charts/ScatterChart";

// Motion
export { fadeIn, slideUp, stagger } from "./motion/presets";

// Privacy
export { ConfidenceBadge, type Confidence } from "./privacy/ConfidenceBadge";
export { CostEstimatedChip } from "./privacy/CostEstimatedChip";
export { FidelityChip, type Fidelity } from "./privacy/FidelityChip";
export {
  InsufficientData,
  type GateReason,
} from "./privacy/InsufficientData";
export {
  RedactedChip,
  renderWithRedactions,
  type RedactedChipProps,
} from "./privacy/RedactedChip";
export {
  RevealDialog,
  type ActionResultLike,
  type RevealDialogProps,
} from "./privacy/RevealDialog";
export {
  REDACTION_MARKER_REGEX,
  findMarkers,
  type MarkerMatch,
  type RedactionType,
} from "./privacy/redactionMarker";
