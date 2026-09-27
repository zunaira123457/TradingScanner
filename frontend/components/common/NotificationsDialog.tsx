'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Bell, BellRing, Check, KeyRound, Loader2, Mail, Send, Share, Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useNotifications, type ChannelResult } from '@/hooks/useNotifications';
import { cn } from '@/lib/utils/cn';

const CHANNEL_LABEL: Record<ChannelResult['channel'], string> = { push: 'Push', email: 'Email', telegram: 'Telegram' };

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-border'
      )}
    >
      <span className={cn('absolute left-0 top-0.5 size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <span className="text-muted">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export function NotificationsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  // Stays true after the first open so the subscription state is kept.
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  const n = useNotifications(opened);
  const [busy, setBusy] = useState<string | null>(null);
  const [ownerKey, setOwnerKey] = useState('');
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const s = n.settings;
  const active = n.subscribed || (s?.subscriptions ?? 0) > 0 || s?.owner;

  const run = async (id: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(id);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setBusy(null);
    }
  };

  const test = () =>
    run('test', async () => {
      const results = await n.sendTest();
      if (results.length === 0) {
        toast.info('Nothing to send to yet', { description: 'Enable push on this device, or unlock owner mode for email/Telegram.' });
        return;
      }
      for (const r of results) {
        if (r.ok) toast.success(`${CHANNEL_LABEL[r.channel]}: sent`);
        else toast.error(`${CHANNEL_LABEL[r.channel]}: failed`, { description: r.detail });
      }
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notification settings" title="Notifications" className="relative">
          {active ? <BellRing /> : <Bell />}
          {active && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-up" />}
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Notifications"
        description="Price alerts keep running on the server, so they reach you even when this page is closed."
        className="scroll-thin max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        {!s ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted">
            {n.error ? (
              <span className="text-down">Couldn’t load notification settings — {n.error.message}</span>
            ) : (
              <>
                <Loader2 className="size-4 animate-spin" /> Loading settings…
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <Section icon={<Smartphone className="size-4" />} title="Push to this device">
              {!s.push.configured ? (
                <p className="text-xs leading-relaxed text-muted">
                  Push isn’t set up on the server yet — add <code className="num">VAPID_PUBLIC_KEY</code> / <code className="num">VAPID_PRIVATE_KEY</code> (run <code className="num">npm run vapid</code>).
                </p>
              ) : n.iosNeedsInstall ? (
                <p className="flex gap-2 rounded-lg bg-panel-2 p-3 text-xs leading-relaxed text-muted">
                  <Share className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    On iPhone/iPad, tap <b className="text-text">Share → Add to Home Screen</b>, open Trading Desk from the new icon, then come back here to enable push.
                  </span>
                </p>
              ) : !n.supported ? (
                <p className="text-xs text-muted">This browser doesn’t support web push.</p>
              ) : n.permission === 'denied' ? (
                <p className="text-xs leading-relaxed text-down">Notifications are blocked for this site. Allow them in your browser’s site settings, then reload.</p>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs leading-relaxed text-muted">
                    {n.subscribed ? 'On — alerts pop up on this device even when the tab is closed.' : 'Get a system notification when an alert triggers.'}
                  </p>
                  {n.subscribed ? (
                    <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => run('push', n.disablePush, 'Push turned off')}>
                      Turn off
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busy !== null || n.checking} onClick={() => run('push', n.enablePush, 'Push enabled on this device')}>
                      {busy === 'push' ? <Loader2 className="animate-spin" /> : <BellRing />} Enable
                    </Button>
                  )}
                </div>
              )}
            </Section>

            <Section icon={<BellRing className="size-4" />} title="New scanner signals">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs leading-relaxed text-muted">Also notify me when the AI scanner finds a new BUY or WATCH setup.</p>
                <Switch
                  checked={s.signals}
                  label="Notify on new scanner signals"
                  disabled={busy !== null || (!n.subscribed && !s.owner)}
                  onChange={(v) => run('signals', () => n.setSignals(v))}
                />
              </div>
              {!n.subscribed && !s.owner && <p className="text-[11px] text-faint">Enable push first.</p>}
            </Section>

            {s.ownerAvailable && (
              <Section icon={<KeyRound className="size-4" />} title="Owner">
                {s.owner ? (
                  <div className="space-y-2">
                    <p className="text-xs leading-relaxed text-muted">This browser is the site owner: your alerts and every new scanner signal are also sent to:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(['email', 'telegram'] as const).map((c) => (
                        <Badge key={c} tone={s.ownerChannels?.[c] ? 'up' : 'neutral'}>
                          {s.ownerChannels?.[c] ? <Check className="size-3" /> : <X className="size-3" />}
                          {c === 'email' ? <Mail className="size-3" /> : <Send className="size-3" />}
                          {CHANNEL_LABEL[c]} {s.ownerChannels?.[c] ? '' : '(not configured)'}
                        </Badge>
                      ))}
                    </div>
                    <button type="button" className="text-[11px] text-muted underline-offset-2 hover:text-text hover:underline" onClick={() => run('owner', n.leaveOwner)}>
                      Stop using this browser as owner
                    </button>
                  </div>
                ) : (
                  <form
                    className="space-y-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setOwnerError(null);
                      void run('owner', async () => {
                        try {
                          await n.unlockOwner(ownerKey);
                          setOwnerKey('');
                          toast.success('Owner mode on', { description: 'You’ll get email/Telegram copies of your alerts and scanner signals.' });
                        } catch (err) {
                          setOwnerError(msg(err));
                        }
                      });
                    }}
                  >
                    <p className="text-xs leading-relaxed text-muted">Site owner? Enter your owner key to also receive email / Telegram notifications.</p>
                    <div className="flex gap-2">
                      <Input type="password" autoComplete="current-password" placeholder="Owner key" value={ownerKey} onChange={(e) => setOwnerKey(e.target.value)} aria-invalid={!!ownerError} />
                      <Button type="submit" size="sm" className="h-9" disabled={!ownerKey || busy !== null}>
                        Unlock
                      </Button>
                    </div>
                    {ownerError && <p className="text-xs text-down">{ownerError}</p>}
                  </form>
                )}
              </Section>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-[11px] leading-relaxed text-faint">Alerts are checked every 30s during market hours (4am–8pm ET).</p>
              <Button variant="outline" size="sm" disabled={busy !== null || !active} onClick={test}>
                {busy === 'test' ? <Loader2 className="animate-spin" /> : <Send />} Send test
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
