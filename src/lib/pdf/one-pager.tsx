import { Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { BRAND } from "./brand";
import type { AuditBlock, OnePagerData } from "./data";

/**
 * The artefact the operator actually carries into a call (§13).
 *
 * One A4 page, laid out the way the call goes: who they are, how they are
 * doing, what is missing, what to say, and how to reach you. The score and the
 * gaps carry the accent because they are the reason the conversation is
 * happening; everything else stays quiet.
 *
 * Type is Helvetica, the PDF built-in. Registering the dashboard's Instrument
 * Serif would mean shipping a font file or fetching one at render time, and a
 * document generator that needs the network to produce a page is a document
 * generator that fails on a train.
 */

const c = BRAND.colors;

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 30,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: c.ink,
    lineHeight: 1.45,
  },

  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: c.ink,
    paddingBottom: 10,
  },
  wordmark: { fontFamily: "Helvetica-Bold", fontSize: 15, letterSpacing: 2 },
  tagline: { fontSize: 7.5, color: c.inkMuted, marginTop: 3 },
  stamp: { fontSize: 7, color: c.inkFaint, textAlign: "right" },

  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginTop: 22,
  },
  name: { fontFamily: "Helvetica-Bold", fontSize: 19, lineHeight: 1.15, maxWidth: 380 },
  subtitle: { fontSize: 9, color: c.inkMuted, marginTop: 5 },

  scoreBox: { alignItems: "flex-end", minWidth: 74 },
  scoreLabel: {
    fontSize: 6.5,
    letterSpacing: 1.2,
    color: c.inkFaint,
    fontFamily: "Helvetica-Bold",
  },
  scoreValue: { fontFamily: "Helvetica-Bold", fontSize: 34, lineHeight: 1 },
  scoreNote: { fontSize: 6.5, color: c.inkFaint, marginTop: 2 },

  factRow: {
    flexDirection: "row",
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: c.rule,
    borderBottomWidth: 1,
    borderBottomColor: c.rule,
    paddingVertical: 11,
  },
  fact: { flex: 1, paddingRight: 10 },
  factLabel: {
    fontSize: 6.5,
    letterSpacing: 1.1,
    color: c.inkFaint,
    fontFamily: "Helvetica-Bold",
    marginBottom: 3,
  },
  factValue: { fontFamily: "Helvetica-Bold", fontSize: 13 },

  section: { marginTop: 20 },
  sectionLabel: {
    fontSize: 6.5,
    letterSpacing: 1.2,
    color: c.inkFaint,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
  },

  chipRow: { flexDirection: "row", flexWrap: "wrap" },
  chip: {
    backgroundColor: c.accentSoft,
    color: c.accent,
    borderRadius: 8,
    paddingVertical: 3.5,
    paddingHorizontal: 8,
    marginRight: 6,
    marginBottom: 6,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
  },

  quoteWrap: { borderLeftWidth: 2, borderLeftColor: c.accent, paddingLeft: 12 },
  quote: { fontSize: 13, lineHeight: 1.35, fontFamily: "Helvetica-Oblique" },

  body: { fontSize: 9.5, lineHeight: 1.5, marginBottom: 6 },
  bulletRow: { flexDirection: "row", marginBottom: 4 },
  bulletMark: { width: 10, color: c.accent, fontFamily: "Helvetica-Bold" },
  bulletText: { flex: 1, fontSize: 9.5, lineHeight: 1.45 },

  footer: {
    position: "absolute",
    bottom: 26,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: c.ink,
    paddingTop: 9,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  footerName: { fontFamily: "Helvetica-Bold", fontSize: 9.5 },
  footerLine: { fontSize: 8, color: c.inkMuted, marginTop: 2 },
  sources: { fontSize: 6.5, color: c.inkFaint, textAlign: "right", maxWidth: 210 },
});

export function OnePager({ data }: { data: OnePagerData }) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandRow}>
        <View>
          <Text style={styles.wordmark}>{BRAND.name}</Text>
          <Text style={styles.tagline}>{BRAND.tagline}</Text>
        </View>
        <Text style={styles.stamp}>
          Prepared {data.generatedAt.toLocaleDateString("en-GB")}
        </Text>
      </View>

      <View style={styles.titleRow}>
        <View>
          <Text style={styles.name}>{data.name}</Text>
          {data.subtitle.length > 0 && (
            <Text style={styles.subtitle}>{data.subtitle}</Text>
          )}
        </View>

        {data.score !== null && (
          <View style={styles.scoreBox}>
            <Text style={styles.scoreLabel}>FIT SCORE</Text>
            <Text
              style={[
                styles.scoreValue,
                { color: data.qualified ? c.accent : c.inkFaint },
              ]}
            >
              {data.score}
            </Text>
            <Text style={styles.scoreNote}>out of 100</Text>
          </View>
        )}
      </View>

      <View style={styles.factRow}>
        {data.facts.map((fact) => (
          <View key={fact.label} style={styles.fact}>
            <Text style={styles.factLabel}>{fact.label.toUpperCase()}</Text>
            <Text style={styles.factValue}>{fact.value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>WHAT IS MISSING</Text>
        {data.gaps.length > 0 ? (
          <View style={styles.chipRow}>
            {data.gaps.map((gap) => (
              <Text key={gap} style={styles.chip}>
                {gap}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={styles.body}>
            Nothing obvious is missing from their public setup.
          </Text>
        )}
      </View>

      {data.openingLine && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>THE ANGLE</Text>
          <View style={styles.quoteWrap}>
            <Text style={styles.quote}>{data.openingLine}</Text>
          </View>
        </View>
      )}

      {data.painHypothesis && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>WHERE THE TIME GOES</Text>
          <Text style={styles.body}>{data.painHypothesis}</Text>
        </View>
      )}

      {data.auditBlocks.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>WHAT IT IS LIKELY COSTING THEM</Text>
          {data.auditBlocks.map((block, index) => (
            <AuditPart key={index} block={block} />
          ))}
        </View>
      )}

      {data.contacts.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>THEIR DETAILS</Text>
          {data.contacts.map((contact) => (
            <Text key={contact.label} style={styles.footerLine}>
              {contact.label}: {contact.value}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.footer} fixed>
        <View>
          <Text style={styles.footerName}>{BRAND.operator}</Text>
          <Text style={styles.footerLine}>
            {BRAND.role}, {BRAND.name.charAt(0) + BRAND.name.slice(1).toLowerCase()}
          </Text>
          <Text style={styles.footerLine}>
            {BRAND.phone} · {BRAND.email} · {BRAND.website}
          </Text>
        </View>

        <Text style={styles.sources}>
          Every figure on this page is taken from {data.sources.join(", ")}. Nothing
          is estimated except where the text says so.
        </Text>
      </View>
    </Page>
  );
}

function AuditPart({ block }: { block: AuditBlock }) {
  if (block.kind === "bullets") {
    return (
      <View>
        {block.items.map((item, index) => (
          <View key={index} style={styles.bulletRow}>
            <Text style={styles.bulletMark}>—</Text>
            <Text style={styles.bulletText}>{item}</Text>
          </View>
        ))}
      </View>
    );
  }

  return <Text style={styles.body}>{block.text}</Text>;
}
