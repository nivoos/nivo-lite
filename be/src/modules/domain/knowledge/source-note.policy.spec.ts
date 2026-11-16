import { Test } from "@nestjs/testing"
import { KnowledgeSourcesErrorCode, StoredNote } from "@modules/domain/knowledge-sources"
import { DocumentsErrorCode } from "@modules/integrations/documents"
import { storedNoteOf } from "./source-note.policy"

const SUBJECT = Symbol("source-note.policy")
type Subject = { storedNoteOf: typeof storedNoteOf }

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { storedNoteOf } }],
    }).compile()
    return moduleRef.get<Subject>(SUBJECT)
}

describe("storedNoteOf", () => {
    it("keeps a reason the front end words: a note, a code of the sources or a code of the documents readers", async () => {
        const subject = await build()

        expect(subject.storedNoteOf(StoredNote.FileMissing)).toBe(StoredNote.FileMissing)
        expect(subject.storedNoteOf(KnowledgeSourcesErrorCode.UploadMissing)).toBe(KnowledgeSourcesErrorCode.UploadMissing)
        expect(subject.storedNoteOf(DocumentsErrorCode.NotPublic)).toBe(DocumentsErrorCode.NotPublic)
    })

    it("stores any other reason, or none, as unreadable: it decides nothing about retrying", async () => {
        const subject = await build()

        expect(subject.storedNoteOf("ECONNREFUSED")).toBe(StoredNote.Unreadable)
        expect(subject.storedNoteOf(undefined)).toBe(StoredNote.Unreadable)
        expect(subject.storedNoteOf(42)).toBe(StoredNote.Unreadable)
    })
})
