# Retained build and release helpers

This PDLC fork does not use GitHub Actions. Workflows and composite Actions are
removed; do not regenerate or restore them. No Actions dependency updates.

Some scripts and declarative inputs here are consumed by standalone packaging,
release and local checks. Preserve those contracts and their hermetic tests.
Use the existing package/tool commands for verification; deleting hosted
entrypoints does not waive security, data, release or user-facing acceptance.
