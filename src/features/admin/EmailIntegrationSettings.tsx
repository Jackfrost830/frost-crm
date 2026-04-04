import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import {
  EmailSyncConfig,
  defaultEmailSyncConfig,
  type EmailSyncConfigState,
} from "./EmailSyncConfig";

type Provider = "gmail" | "outlook";
type ConnectionStatus = "connected" | "disconnected";

interface ProviderConnection {
  provider: Provider;
  status: ConnectionStatus;
  email?: string;
  lastSyncAt?: string;
}

const initialConnections: ProviderConnection[] = [
  { provider: "gmail", status: "disconnected" },
  { provider: "outlook", status: "disconnected" },
];

const providerLabels: Record<Provider, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
};

function ProviderCard({
  connection,
  onConnect,
}: {
  connection: ProviderConnection;
  onConnect: (provider: Provider) => void;
}) {
  const isConnected = connection.status === "connected";
  const label = providerLabels[connection.provider];

  return (
    <Card className="flex flex-col justify-between">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Mail className="h-5 w-5 text-muted-foreground" />
            </div>
            <CardTitle className="text-base">{label}</CardTitle>
          </div>
          {isConnected ? (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
              Connected
            </Badge>
          ) : (
            <Badge variant="secondary">Not Connected</Badge>
          )}
        </div>
        {isConnected && connection.email && (
          <CardDescription className="pt-1">
            Syncing as {connection.email}
          </CardDescription>
        )}
        {isConnected && connection.lastSyncAt && (
          <p className="text-xs text-muted-foreground">
            Last sync: {new Date(connection.lastSyncAt).toLocaleString()}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <Button
          variant={isConnected ? "outline" : "default"}
          size="sm"
          className="w-full"
          onClick={() => onConnect(connection.provider)}
        >
          {isConnected ? `Disconnect ${label}` : `Connect ${label}`}
        </Button>
      </CardContent>
    </Card>
  );
}

export function EmailIntegrationSettings() {
  const [connections] = useState<ProviderConnection[]>(initialConnections);
  const [config, setConfig] = useState<EmailSyncConfigState>(
    defaultEmailSyncConfig
  );

  function handleConnect(provider: Provider) {
    const label = providerLabels[provider];
    toast.info(`${label} OAuth connection requires Edge Function deployment`, {
      description:
        "Deploy the sync-emails Edge Function and configure OAuth credentials to enable email sync.",
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Integration</CardTitle>
        <CardDescription>
          Connect your email to automatically log emails to and from CRM
          contacts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Provider connection cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {connections.map((conn) => (
            <ProviderCard
              key={conn.provider}
              connection={conn}
              onConnect={handleConnect}
            />
          ))}
        </div>

        {/* How it works */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">How it works</h4>
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
            <li>Connect your email account</li>
            <li>We automatically match emails to contacts in the CRM</li>
            <li>
              Activities are created for matching emails on the contact and
              account
            </li>
          </ol>
        </div>

        <Separator />

        {/* Sync settings */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium">Settings</h4>
          <EmailSyncConfig
            config={config}
            onChange={setConfig}
            disabled={false}
          />
        </div>
      </CardContent>
    </Card>
  );
}
