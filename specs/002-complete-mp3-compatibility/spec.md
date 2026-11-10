# 002 · Complete MP3 compatibility

## Outcome and relationship

Extend the verified 001 endpoint to the agreed free-format and metadata cases.
This replaces 001 C02–C04's intermediate compatibility boundary; its HTTP contract,
physical counts, errors and byte limit remain in force. No transport lifecycle or
deployment features are introduced here.

## Acceptance

| ID  | Observable requirement                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M01 | All 001 real fixtures keep their established results; the committed free-format MPEG-1 fixture returns 22 through both the parser and real HTTP.                                                                                                                                                |
| M02 | Infer free-format lengths only from compatible MPEG-1 Layer III boundaries. Account for per-frame padding and sample-rate changes. Reject an isolated unresolved free-format frame and lengths smaller than framing overhead.                                                                   |
| M03 | Treat a locally plausible free-format length as provisional until the complete remaining layout validates. Try candidate boundary offsets in ascending order, retrying saved choices depth-first after a failed suffix. Choose the first complete valid layout when several exist.              |
| M04 | Bound candidate selection to 4,096 per file and charged framing scan/traversal work to 8× file size, including retries. Exhaustion is an invalid-media result, not a partial count. This is not a promise about physical disk I/O or all metadata work.                                         |
| M05 | Accept leading ID3v2 envelopes and paired APEv2; accept terminal ID3v1, APEv1/v2 and appended paired ID3v2.4. Validate descriptor lengths, allowed flags, required pairs and reserved fields at known boundaries.                                                                               |
| M06 | Traverse stacked terminal metadata iteratively and accept a valid complete chain when a competing tag-like descriptor is payload. Bound alternative interpretations to 4,096 across the whole file, including repeated suffix checks; ordinary unambiguous chains have no artificial depth cap. |
| M07 | Frame traversal takes precedence over speculative metadata trimming. Tag-like bytes inside short or final frame payloads remain audio. Reject incomplete/mismatched envelopes, junk and no-frame inputs.                                                                                        |
| M08 | Cancellation applies during cached as well as physical reads. Retained state and read buffers are bounded; candidate choices do not retain a copy of every scan window.                                                                                                                         |
| M09 | The complete verify gate preserves prior tests and adds independent real-audio evidence and focused ambiguity/malformed regressions. Document what structural validation does not establish.                                                                                                    |

## Scenarios

1. Upload the unchanged free-format fixture and receive 22 with exact JSON shape.
2. Count frames whose payload contains plausible free headers or tag signatures;
   the full valid physical layout determines the result.
3. Count a long ordinary metadata chain without stack exhaustion, and reject an
   adversarial search that exceeds the documented ambiguity budgets.

CRC values, compressed audio samples and metadata item contents remain outside
structural validation. MPEG-2/2.5 and other layers remain outside the assignment.
APEv1 is footer-only: this service requires its flags to be zero and never infers
an APEv1 header. Only APEv2 has a header/footer pairing interpretation.
Record actual verification before merging and selecting 003.
