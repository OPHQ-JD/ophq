from pathlib import Path
p=Path('src/App.jsx')
s=p.read_text()
# 1 stock statuses add consumed maybe Low Stock existing uses but not in list? include
s=s.replace('const stockStatuses = ["In Stock", "On Order"];','const stockStatuses = ["In Stock", "On Order", "Allocated", "Offcut", "Consumed", "Scrapped"];')
# 2 add helper functions after getStockTraceabilityNumber
old='''function getStockTraceabilityNumber(item = {}) {\n  return item.purchaseDocumentNo || item.poNo || item.enquiryNo || item.purchaseDocumentId || "Manual stock";\n}\n'''
new='''function getStockTraceabilityNumber(item = {}) {\n  return item.purchaseDocumentNo || item.poNo || item.enquiryNo || item.purchaseDocumentId || "Manual stock";\n}\n\nfunction getPoLineOrderedLengthM(line = {}) {\n  return normaliseLengthM(line.orderedLength || line.orderLength || line.stockLength || line.length) || Number(line.orderedLength || line.orderLength || line.stockLength || line.length || 0);\n}\n\nfunction getPoLineAllocatedLengthM(line = {}) {\n  return normaliseLengthM(line.allocatedLength || line.requiredLength || line.cutLength || line.jobLength || line.requiredCutLength || line.length) || Number(line.allocatedLength || line.requiredLength || line.cutLength || line.jobLength || line.requiredCutLength || line.length || 0);\n}\n\nfunction createStockSegmentsForFixedLine(item = {}, status = "Available") {\n  const quantity = Math.max(1, Number(item.quantity || 1));\n  const lengthM = Number(item.length || normaliseLengthM(item.lengthText) || 0);\n  return Array.from({ length: quantity }, (_, index) => ({\n    id: `${item.id || "stock"}-seg-${index + 1}`,\n    originalLengthM: lengthM,\n    availableLengthM: lengthM,\n    status,\n    sourceStatus: item.status || "In Stock",\n    allocatedJobId: item.allocatedJobId || "",\n    allocations: item.allocatedJobId ? [{ id: createEntityId("stock-allocation"), jobId: item.allocatedJobId, lengthM, partId: item.sourcePoLineId || "", status: "Allocated", allocatedAt: new Date().toISOString() }] : [],\n  }));\n}\n'''
s=s.replace(old,new)
# 3 replace createStockItemFromPoLine and createStockItemsFromPurchasingDocument
start=s.index('function createStockItemFromPoLine')
end=s.index('\nfunction runStockLengthAllocationTests', start)
replacement=r'''function createStockLinesFromPoLine(line = {}, po = {}, status = "On Order") {
  const orderedLengthM = getPoLineOrderedLengthM(line);
  const allocatedLengthM = Math.min(orderedLengthM, getPoLineAllocatedLengthM(line) || orderedLengthM);
  const offcutLengthM = Math.max(0, orderedLengthM - allocatedLengthM);
  const quantity = Math.max(1, Number(line.quantity || 1));
  const common = {
    productId: line.productId || "",
    sectionSize: line.sectionSize || "",
    grade: line.grade || "S355",
    finish: line.finish || "Self colour",
    quantity,
    location: status === "On Order" ? "On order" : "Goods in",
    purchaseDocumentId: po.id || "",
    purchaseDocumentNo: getPurchasingDocumentNumber(po),
    sourceJobId: po.jobId || "",
    sourcePoLineId: line.id || "",
  };
  const rows = [];
  if (allocatedLengthM > 0) {
    const allocated = {
      ...common,
      id: createEntityId("stock-allocated"),
      length: allocatedLengthM,
      status: status === "On Order" ? "On Order" : "Allocated",
      stockLineType: "Allocated",
      allocatedJobId: po.jobId || "",
      notes: `Allocated cut from ${getPurchasingDocumentTitle(po)} ${getPurchasingDocumentNumber(po)}. Cut ${formatLengthM(allocatedLengthM)} from ordered ${formatLengthM(orderedLengthM)}.`,
    };
    rows.push({ ...allocated, lengthSegments: createStockSegmentsForFixedLine(allocated, "Allocated") });
  }
  if (offcutLengthM > 0) {
    const offcut = {
      ...common,
      id: createEntityId("stock-offcut"),
      length: offcutLengthM,
      status: status === "On Order" ? "On Order" : "Offcut",
      stockLineType: "Offcut",
      allocatedJobId: "",
      sourceOrderedLengthM: orderedLengthM,
      sourceAllocatedLengthM: allocatedLengthM,
      notes: `Offcut created from ${getPurchasingDocumentTitle(po)} ${getPurchasingDocumentNumber(po)} after allocated cut ${formatLengthM(allocatedLengthM)}.`,
    };
    rows.push({ ...offcut, lengthSegments: createStockSegmentsForFixedLine(offcut, "Offcut") });
  }
  return rows;
}

function createStockItemFromPoLine(line = {}, po = {}, status = "On Order") {
  return createStockLinesFromPoLine(line, po, status)[0] || null;
}

function createStockItemsFromPurchasingDocument(po = {}, status = "On Order") {
  if (isEnquiryDocument(po)) return [];
  return (po.items || [])
    .filter((line) => line.productId && line.sectionSize && getPoLineOrderedLengthM(line) > 0)
    .flatMap((line) => createStockLinesFromPoLine(line, po, status));
}

function consumeAllocatedStockLine(stockItems = [], stockItemId = "") {
  if (!stockItemId) return stockItems;
  return stockItems.filter((item) => item.id !== stockItemId);
}

function cutOffcutStockLine(stockItems = [], { stockItemId = "", lengthM = 0, jobId = "" }) {
  const cutLength = Number(lengthM || 0);
  if (!stockItemId || cutLength <= 0) return stockItems;
  const now = new Date().toISOString();
  const output = [];
  stockItems.forEach((item) => {
    if (item.id !== stockItemId) {
      output.push(item);
      return;
    }
    const sourceLength = Number(item.length || getRemainingLengthForStockItem(item) || 0);
    if (cutLength > sourceLength + 0.0001) {
      output.push(item);
      return;
    }
    const remaining = Math.max(0, sourceLength - cutLength);
    const cutLine = {
      ...item,
      id: createEntityId("stock-cut"),
      length: cutLength,
      quantity: 1,
      status: "Allocated",
      stockLineType: "Allocated Cut",
      allocatedJobId: jobId || item.allocatedJobId || "",
      cutFromStockItemId: item.id,
      notes: [`Manual cut ${formatLengthM(cutLength)} from offcut ${item.id}.`, jobId ? `Allocated to job ${jobId}.` : "Manual cut not job-linked."].join(" "),
    };
    output.push({ ...cutLine, lengthSegments: createStockSegmentsForFixedLine(cutLine, "Allocated") });
    if (remaining > 0.0001) {
      const offcutLine = {
        ...item,
        id: createEntityId("stock-offcut"),
        length: remaining,
        quantity: 1,
        status: item.status === "On Order" ? "On Order" : "Offcut",
        stockLineType: "Offcut",
        allocatedJobId: "",
        notes: [item.notes, `Remaining offcut after manual cut ${formatLengthM(cutLength)} on ${now}.`].filter(Boolean).join(" | "),
      };
      output.push({ ...offcutLine, lengthSegments: createStockSegmentsForFixedLine(offcutLine, "Offcut") });
    }
  });
  return output;
}
'''
s=s[:start]+replacement+s[end:]
# 4 createPoLineFromPart add requiredCutLength and orderedLength? 
s=s.replace('''  const length = part.length ? String(part.length) : "";\n  const qty = Math.max(1, Number(quantity || part.quantity || 1));''','''  const length = part.length ? String(part.length) : "";\n  const requiredCutLength = part.requiredCutLength || part.length || "";\n  const qty = Math.max(1, Number(quantity || part.quantity || 1));''')
s=s.replace('''    length,\n    quantity: qty,''','''    length,\n    requiredCutLength,\n    quantity: qty,''')
# 5 build desc include required if different? skip
# 6 add handlers after scrapStockItemSegment
old='''  function scrapStockItemSegment(stockItemId, segmentId) {\n    if (!actionService.guard("canUpdate", "stock_items", "Stock offcut scrapped/removed from available inventory.")) return;\n    const reason = typeof window !== "undefined" ? window.prompt("Reason for scrapping/removing this offcut?", "Scrapped offcut") : "Scrapped offcut";\n    setStockItems((current) => scrapStockSegment(current, { stockItemId, segmentId, reason: reason || "Scrapped offcut" }));\n  }\n'''
new='''  function scrapStockItemSegment(stockItemId, segmentId) {\n    if (!actionService.guard("canUpdate", "stock_items", "Stock offcut scrapped/removed from available inventory.")) return;\n    const reason = typeof window !== "undefined" ? window.prompt("Reason for scrapping/removing this offcut?", "Scrapped offcut") : "Scrapped offcut";\n    setStockItems((current) => scrapStockSegment(current, { stockItemId, segmentId, reason: reason || "Scrapped offcut" }));\n  }\n\n  function cutAllocatedStockItem(stockItemId) {\n    if (!actionService.guard("canDelete", "stock_items", "Allocated stock cut and consumed.")) return;\n    setStockItems((current) => consumeAllocatedStockLine(current, stockItemId));\n  }\n\n  function manualCutOffcutStockItem(stockItemId) {\n    if (!actionService.guard("canUpdate", "stock_items", "Manual cut taken from offcut stock.")) return;\n    const source = stockItems.find((item) => item.id === stockItemId);\n    const maxLength = Number(source?.length || getRemainingLengthForStockItem(source) || 0);\n    const input = typeof window !== "undefined" ? window.prompt(`Cut length in metres from this offcut? Max ${formatLengthM(maxLength)}`, "") : "";\n    const cutLength = normaliseLengthM(input) || Number(input || 0);\n    if (!cutLength || cutLength <= 0 || cutLength > maxLength + 0.0001) return;\n    const jobId = typeof window !== "undefined" ? window.prompt("Optional job ID to allocate this manual cut to. Leave blank if not job-linked.", source?.allocatedJobId || "") : "";\n    setStockItems((current) => cutOffcutStockLine(current, { stockItemId, lengthM: cutLength, jobId: jobId || "" }));\n  }\n'''
s=s.replace(old,new)
# 7 updatePOStatus stock creation only for PO Sent? Remove Enquiry Sent creation
old='''    if ((status === "Sent" || status === "Enquiry Sent") && po) {\n      const onOrderItems = createStockItemsFromPurchasingDocument(po, "On Order");\n      if (onOrderItems.length) setStockItems((current) => {\n        const existingDocIds = new Set(current.filter((item) => item.purchaseDocumentId === po.id).map((item) => `${item.productId}-${item.sectionSize}-${item.length}`));\n        const freshItems = onOrderItems.filter((item) => !existingDocIds.has(`${item.productId}-${item.sectionSize}-${item.length}`));\n        return freshItems.length ? [...freshItems, ...current] : current;\n      });\n    }\n'''
new='''    if (status === "Sent" && po && !isEnquiryDocument(po)) {\n      const onOrderItems = createStockItemsFromPurchasingDocument(po, "On Order");\n      if (onOrderItems.length) setStockItems((current) => {\n        const hasDocumentStock = current.some((item) => item.purchaseDocumentId === po.id);\n        return hasDocumentStock ? current : [...onOrderItems, ...current];\n      });\n    }\n'''
s=s.replace(old,new)
# 8 raisePoFromEnquiry creates stock on Draft PO
old='''    actionService.updateRecord({\n      resource: "purchase_orders",\n      id: poId,\n      patch: { ...enquiry, ...totals, documentKind: "Purchase Order", poNo: reservedPoNumber.number, status: "Draft PO", raisedFromEnquiryNo: enquiry.enquiryNo || "" },\n      setter: setPurchaseOrders,\n      notes: "Supplier enquiry converted to formal purchase order.",\n    });\n'''
new='''    const raisedPo = { ...enquiry, ...totals, documentKind: "Purchase Order", poNo: reservedPoNumber.number, status: "Draft PO", raisedFromEnquiryNo: enquiry.enquiryNo || "" };\n    actionService.updateRecord({\n      resource: "purchase_orders",\n      id: poId,\n      patch: raisedPo,\n      setter: setPurchaseOrders,\n      notes: "Supplier enquiry converted to formal purchase order.",\n    });\n    const onOrderItems = createStockItemsFromPurchasingDocument(raisedPo, "On Order");\n    if (onOrderItems.length) setStockItems((current) => current.some((item) => item.purchaseDocumentId === raisedPo.id) ? current : [...onOrderItems, ...current]);\n'''
s=s.replace(old,new)
# 9 direct addPurchaseOrder after create add stock? The create function snippet known
old='''    const created = actionService.createRecord({ resource: "purchase_orders", record: po, setter: setPurchaseOrders, notes: "Purchase order raised against job." });\n    if (!created) return;\n    updateJob(job.id, { status: "Waiting Material", materialsDue: newPo.requiredBy });\n'''
new='''    const created = actionService.createRecord({ resource: "purchase_orders", record: po, setter: setPurchaseOrders, notes: "Purchase order raised against job." });\n    if (!created) return;\n    const onOrderItems = createStockItemsFromPurchasingDocument(po, "On Order");\n    if (onOrderItems.length) setStockItems((current) => [...onOrderItems, ...current]);\n    updateJob(job.id, { status: "Waiting Material", materialsDue: newPo.requiredBy });\n'''
s=s.replace(old,new)
# 10 editing UI line add allocated length field
s=s.replace('''                                  <Field label="Length"><TextInput value={item.length || ""} onChange={(event) => updateEditingPoLine(item.id, { length: event.target.value })} placeholder="e.g. 6m / 4400mm" /></Field>\n                                  <Field label="Quantity"><SelectInput value={item.quantity || 1} onChange={(event) => updateEditingPoLine(item.id, { quantity: event.target.value })}>{Array.from({ length: 20 }, (_, qtyIndex) => qtyIndex + 1).map((qty) => <option key={qty} value={qty}>{qty}</option>)}</SelectInput></Field>''','''                                  <Field label="Ordered length"><TextInput value={item.length || ""} onChange={(event) => updateEditingPoLine(item.id, { length: event.target.value })} placeholder="e.g. 6m / 4400mm" /></Field>\n                                  <Field label="Allocated cut"><TextInput value={item.requiredCutLength || item.allocatedLength || item.length || ""} onChange={(event) => updateEditingPoLine(item.id, { requiredCutLength: event.target.value })} placeholder="job cut e.g. 4m" /></Field>\n                                  <Field label="Quantity"><SelectInput value={item.quantity || 1} onChange={(event) => updateEditingPoLine(item.id, { quantity: event.target.value })}>{Array.from({ length: 20 }, (_, qtyIndex) => qtyIndex + 1).map((qty) => <option key={qty} value={qty}>{qty}</option>)}</SelectInput></Field>''')
# 11 StockInventoryTab props
s=s.replace('function StockInventoryTab({ stockItems, jobs, newStockItem, setNewStockItem, onAddStockItem, onUpdateStockItem, onAllocateStockItem, onScrapStockSegment, customProducts }) {','function StockInventoryTab({ stockItems, jobs, newStockItem, setNewStockItem, onAddStockItem, onUpdateStockItem, onAllocateStockItem, onScrapStockSegment, onCutAllocatedStockItem, onManualCutOffcutStockItem, customProducts }) {')
# 12 Add actions buttons in segment area after scrap button
old='''                        {segment.status !== "Consumed" && Number(segment.availableLengthM || 0) > 0 ? <button className="mt-2 rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-black text-red-700" onClick={() => onScrapStockSegment(item.id, segment.id)}>Scrap / remove offcut</button> : null}'''
new='''                        {item.stockLineType === "Allocated" || item.stockLineType === "Allocated Cut" ? <button className="mt-2 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-[11px] font-black text-emerald-700" onClick={() => onCutAllocatedStockItem(item.id)}>Cut / consume allocated line</button> : null}\n                        {(item.stockLineType === "Offcut" || segment.status === "Offcut") && segment.status !== "Consumed" && Number(segment.availableLengthM || 0) > 0 ? <div className="mt-2 flex flex-wrap gap-2"><button className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-[11px] font-black text-blue-700" onClick={() => onManualCutOffcutStockItem(item.id)}>Manual cut</button><button className="rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-black text-red-700" onClick={() => onScrapStockSegment(item.id, segment.id)}>Scrap offcut</button></div> : null}'''
s=s.replace(old,new)
# 13 pass props
s=s.replace('''            onScrapStockSegment={scrapStockItemSegment}\n            customProducts={customProducts}''','''            onScrapStockSegment={scrapStockItemSegment}\n            onCutAllocatedStockItem={cutAllocatedStockItem}\n            onManualCutOffcutStockItem={manualCutOffcutStockItem}\n            customProducts={customProducts}''')
# 14 Change description header maybe PO / Enquiry no stock note
s=s.replace('Track stock on site, on order, allocated job lengths, offcuts and PO/enquiry traceability.','Track stock on site, on order, allocated job lengths, offcuts and PO traceability. Enquiries do not create stock until raised as POs.')
# 15 Add tests console
s=s.replace('console.assert(runStockLengthAllocationTests().passed === true, "stock length allocation tests should pass");','console.assert(runStockLengthAllocationTests().passed === true, "stock length allocation tests should pass");\n  const enquiryStockTest = createStockItemsFromPurchasingDocument({ id: "enq-test", enquiryNo: "ENQ-00001", documentKind: "Enquiry", status: "Enquiry Sent", items: [{ id: "l1", productId: "ub", sectionSize: "203x102x23", length: 6, requiredCutLength: 4, quantity: 1 }] }, "On Order");\n  console.assert(enquiryStockTest.length === 0, "enquiries should not create stock inventory lines");\n  const poStockTest = createStockItemsFromPurchasingDocument({ id: "po-test", poNo: "PO-00001", documentKind: "Purchase Order", status: "Draft PO", jobId: "job-a", items: [{ id: "l1", productId: "ub", sectionSize: "203x102x23", length: 6, requiredCutLength: 4, quantity: 1 }] }, "On Order");\n  console.assert(poStockTest.length === 2 && poStockTest.some((item) => item.stockLineType === "Allocated") && poStockTest.some((item) => item.stockLineType === "Offcut"), "raised PO should create allocated and offcut stock lines");\n  const manualCutTest = cutOffcutStockLine([{ id: "offcut-test", productId: "ub", sectionSize: "203x102x23", length: 2, quantity: 1, status: "Offcut", stockLineType: "Offcut", lengthSegments: [{ id: "offcut-test-seg-1", originalLengthM: 2, availableLengthM: 2, status: "Offcut", allocations: [] }] }], { stockItemId: "offcut-test", lengthM: 0.75 });\n  console.assert(manualCutTest.length === 2 && manualCutTest.some((item) => item.stockLineType === "Allocated Cut") && manualCutTest.some((item) => item.stockLineType === "Offcut" && Math.abs(Number(item.length || 0) - 1.25) < 0.001), "manual offcut cut should create a cut line and remaining offcut line");')
p.write_text(s)
print('patched')
