import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pdbId: string }> }
) {
  try {
    const { pdbId } = await params;
    const upperPdbId = pdbId.toUpperCase();

    if (!/^[A-Za-z0-9]{4}$/.test(upperPdbId)) {
      return NextResponse.json(
        { error: "Invalid PDB ID format. Must be 4 alphanumeric characters." },
        { status: 400 }
      );
    }

    // Use RCSB FASTA endpoint (PDBe doesn't have a FASTA API)
    const response = await fetch(
      `https://www.rcsb.org/fasta/entry/${upperPdbId}`,
      { next: { revalidate: 3600 } }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch sequence data for PDB ID: ${upperPdbId}` },
        { status: response.status }
      );
    }

    const text = await response.text();

    // Parse FASTA format
    // RCSB FASTA headers look like:
    // >1MBN_1|Chain A|MYOGLOBIN|Physeter catodon (9755)
    // >7BV2_1|Chain A|RNA-directed RNA polymerase|Severe acute respiratory syndrome coronavirus 2 (2697049)
    const sequences: Record<string, string> = {};
    let currentChain: string | null = null;
    let currentSeq = "";

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith(">")) {
        // Save previous sequence
        if (currentChain !== null) {
          sequences[currentChain] = currentSeq;
        }

        // Parse chain ID from header
        // Format: >PDB_ID_EntityNum|Chain X[auth Y]|Description|Organism (taxid)
        const header = trimmed.substring(1);
        
        // Try: |Chain X| or |Chains X,Y|
        const chainMatch = header.match(/[Cc]hains?\s+([A-Za-z0-9](?:[A-Za-z0-9,\s]*[A-Za-z0-9])?)/);
        if (chainMatch) {
          const chainPart = chainMatch[1];
          // For multi-chain entries like "Chains A,B", take first chain
          currentChain = chainPart.split(",")[0].trim().toUpperCase();
          
          // Check for auth chain ID: "Chain E[auth T]" -> use T
          const authMatch = header.match(/\[auth\s+([A-Za-z0-9]+)\]/);
          if (authMatch) {
            currentChain = authMatch[1].toUpperCase();
          }
        } else {
          // Fallback: try to extract from entity number
          const entityMatch = header.match(/_(\d+)\|/);
          currentChain = entityMatch ? `E${entityMatch[1]}` : null;
        }

        currentSeq = "";
      } else {
        // Sequence line
        currentSeq += trimmed;
      }
    }

    // Don't forget the last sequence
    if (currentChain !== null) {
      sequences[currentChain] = currentSeq;
    }

    return NextResponse.json({
      pdb_id: upperPdbId,
      sequences,
    });
  } catch (error) {
    console.error("[API /sequence] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch sequence data" },
      { status: 500 }
    );
  }
}
