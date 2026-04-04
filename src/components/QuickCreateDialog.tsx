import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Building2, Users, UserPlus, Target } from "lucide-react";

interface QuickCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const createOptions = [
  {
    label: "Account",
    icon: Building2,
    path: "/accounts/new",
    description: "Create a new company or organization",
  },
  {
    label: "Contact",
    icon: Users,
    path: "/contacts/new",
    description: "Add a new person",
  },
  {
    label: "Lead",
    icon: UserPlus,
    path: "/leads/new",
    description: "Track a new prospect",
  },
  {
    label: "Opportunity",
    icon: Target,
    path: "/opportunities/new",
    description: "Start a new deal",
  },
];

export function QuickCreateDialog({
  open,
  onOpenChange,
}: QuickCreateDialogProps) {
  const navigate = useNavigate();

  function handleSelect(path: string) {
    onOpenChange(false);
    navigate(path);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Quick Create"
      description="Choose a record type to create"
    >
      <CommandInput placeholder="What would you like to create?" />
      <CommandList>
        <CommandEmpty>No matching record type.</CommandEmpty>
        <CommandGroup heading="Create New">
          {createOptions.map((option) => (
            <CommandItem
              key={option.path}
              value={option.label}
              onSelect={() => handleSelect(option.path)}
            >
              <option.icon className="h-4 w-4 text-muted-foreground" />
              <div className="flex flex-col">
                <span>{option.label}</span>
                <span className="text-xs text-muted-foreground">
                  {option.description}
                </span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
