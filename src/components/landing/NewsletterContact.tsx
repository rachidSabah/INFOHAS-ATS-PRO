"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionTitle, Icon } from "@/components/shared";
import { toast } from "sonner";

export function NewsletterContact() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  const subscribe = async () => {
    if (!email || !/.+@.+\..+/.test(email)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    setSending(true);
    await new Promise((r) => setTimeout(r, 600));
    setSending(false);
    toast.success("You're in! Check your inbox for a confirmation.");
    setEmail("");
  };

  const submit = async () => {
    if (!msg.trim() || !email.trim()) {
      toast.error("Please fill in both fields.");
      return;
    }
    setSending(true);
    await new Promise((r) => setTimeout(r, 800));
    setSending(false);
    toast.success("Message sent! We'll reply within 24 hours.");
    setEmail("");
    setMsg("");
  };

  return (
    <section id="contact" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-10">
          {/* Newsletter */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="rounded-3xl bg-card border border-border shadow-premium p-8 relative overflow-hidden"
          >
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-brand/10 blur-3xl" />
            <div className="relative">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-light text-brand text-xs font-semibold dark:bg-brand/15">
                <Icon name="Mail" className="w-3 h-3" /> Newsletter
              </span>
              <h3 className="font-display text-2xl font-bold mt-4 mb-2">Get hiring intel in your inbox</h3>
              <p className="text-sm text-muted-foreground mb-5 text-pretty">
                One practical email every other week. No fluff, no spam. Unsubscribe in one click.
              </p>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1"
                  onKeyDown={(e) => e.key === "Enter" && subscribe()}
                />
                <Button onClick={subscribe} disabled={sending} className="bg-brand hover:bg-brand-dark text-white gap-2">
                  {sending ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Send" className="w-4 h-4" />}
                  Subscribe
                </Button>
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Icon name="Users" className="w-3 h-3" /> 84,000+ subscribers</span>
                <span className="flex items-center gap-1"><Icon name="ShieldCheck" className="w-3 h-3" /> GDPR-compliant</span>
              </div>
            </div>
          </motion.div>

          {/* Contact */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="rounded-3xl bg-card border border-border shadow-premium p-8"
          >
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold dark:bg-amber-400/10 dark:text-amber-300">
              <Icon name="MessageCircle" className="w-3 h-3" /> Contact
            </span>
            <h3 className="font-display text-2xl font-bold mt-4 mb-2">Talk to a human</h3>
            <p className="text-sm text-muted-foreground mb-5 text-pretty">
              Feature request, bug report, or partnership idea? We reply within 24 hours.
            </p>
            <div className="space-y-3">
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <textarea
                placeholder="What's on your mind?"
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button onClick={submit} disabled={sending} className="w-full bg-brand hover:bg-brand-dark text-white gap-2">
                {sending ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Send" className="w-4 h-4" />}
                Send message
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
