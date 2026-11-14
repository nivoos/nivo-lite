function run(input, ctx) {
    const summary = ctx.tool("demo.model.complete", { prompt: "Summarise this lead in one line: " + input.name });
    const made = ctx.tool("nivo.tool.crm.lead.create", { name: input.name, email: input.email });
    if (!made.ok)
        return ctx.cannot("lead refused: " + made.refusal);
    ctx.tool("nivo.tool.record.update", {
        recordId: input.recordId,
        fields: { leadId: made.value.leadId, summary: summary.ok ? summary.value.text : "" },
    });
    return { leadId: made.value.leadId };
}
