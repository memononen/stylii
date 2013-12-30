
function Undo(maxUndos) {
	this.states = [];
	this.head = -1;
	this.maxUndos = maxUndos || 10;
	this.updateUI();
}

Undo.prototype.snapshot = function(name) {

//	console.log("snapshot() layers: "+paper.project.layers);

	// Update previous state's selection to the selection as of now
	// so that undo feels more natural after undo. Omitting this
	// makes the undo feel like it lost your selection.
	if (this.head >= 0 && this.head < this.states.length)
		this.states[this.head].selection = this.snapshotSelection();

	// HACK: Store original ID into the data of an item.
	this.captureIDs();

	var state = {
		name: name,
		stamp: Date.now(),
		json: this.snapshotProject(),
		selection: this.snapshotSelection()
	};

	// Group similar actions done close to each other.
/*	if (this.states.length > 0 && this.head == (this.states.length-1)) {
		var last = this.states[this.states.length-1];
		if (last.name == state.name && (state.stamp - last.stamp) < 5000) {
			last.json = state.json;
			last.selection = state.selection;
			return;
		}
	}*/

	// Discard states after the current one.
	if (this.head < this.states.length-1)
		this.states = this.states.slice(0, this.head+1);

	this.states.push(state);

	// Remove the oldest state if we have too many states.
	if (this.states.length > this.maxUndos)
		this.states.shift();

	this.head = this.states.length-1;

	this.updateUI();
}

Undo.prototype.restoreIDs = function() {
	// Restore IDs from the 'data'.
	var maxId = 0;
	function visitItem(item) {
		if (item.data.id) {
			item._id = item.data.id;
			if (item.id > maxId)
				maxId = item.id;
		}
		if (item.children) {
			for (var j = item.children.length-1; j >= 0; j--)
				visitItem(item.children[j]);
		}
	}
	for (var i = 0, l = paper.project.layers.length; i < l; i++) {
		var layer = paper.project.layers[i];
		visitItem(layer);
	}
	if (maxId > Item._id)
		Item._id = maxId;
}

Undo.prototype.captureIDs = function() {
	// Store IDs of the items into 'data' so that they get serialized.
	function visitItem(item) {
		item.data.id = item.id;
		if (item.children) {
			for (var j = item.children.length-1; j >= 0; j--)
				visitItem(item.children[j]);
		}
	}
	for (var i = 0, l = paper.project.layers.length; i < l; i++) {
		var layer = paper.project.layers[i];
		visitItem(layer);
	}
}

Undo.prototype.snapshotProject = function() {
	var json = paper.Base.serialize(paper.project); //paper.project.exportJSON();
	// TODO: Remove objects marked as guides.
	return json;
}

Undo.prototype.snapshotSelection = function() {
	var selection = [];
	var selected = paper.project.selectedItems;
	for (var i = 0; i < selected.length; i++) {
		var item = selected[i];
		if (item.guide) continue;
		var state = {id: item.id, segs: []};
		if (item instanceof paper.Path) {
			var segs = [];
			for (var j = 0; j < item.segments.length; j++) {
				if (item.segments[j].selected)
					segs.push(item.segments[j].index);
			}
			if (segs.length > 0) {
				state.segs = segs;
			}
		}
		selection.push(state);
	}
	return selection;
}

Undo.prototype.restoreSelection = function(sel) {
	paper.project.deselectAll();
	// HACK: some logic in Paper.js prevents deselectAll in some cases,
	// enforce deselect.
	paper.project._selectedItems = {};

	for (var i = 0; i < sel.length; i++) {
		var state = sel[i];
		var item = findItemById(state.id);
		if (item == null) {
			console.log("restoreSelection: could not find "+state.id);
			continue;
		}
		item.selected = true;
		for (var j = 0; j < state.segs.length; j++) {
			var idx = state.segs[j];
			if (idx >= 0 && idx < item.segments.length)
				item.segments[idx].selected = true;
		}
	}
}

Undo.prototype.restore = function(state) {
	// Empty the project and deserialize the project from JSON.
	paper.project.clear();
	paper.project.importJSON(state.json);
	// HACK: paper does not retain IDs, we capture them on snapshot,
	// restore them here.
	this.restoreIDs();

	// Selection is serialized separately, restore now (requires correct IDs).
	this.restoreSelection(state.selection);

	// Update UI
	updateSelectionState();
	paper.project.view.update();
}

Undo.prototype.undo = function() {
	if (this.head > 0) {
		this.head--;
		this.restore(this.states[this.head]);
	}
	this.updateUI();
}

Undo.prototype.redo = function() {
	if (this.head < this.states.length-1) {
		this.head++;
		this.restore(this.states[this.head]);
	}
	this.updateUI();
}

Undo.prototype.canUndo = function() {
	return this.head > 0;
}

Undo.prototype.canRedo = function() {
	return this.head < this.states.length-1;
}

Undo.prototype.updateUI = function() {
	if (this.canUndo())
		$("#undo").removeClass("disabled");
	else
		$("#undo").addClass("disabled");

	if (this.canRedo())
		$("#redo").removeClass("disabled");
	else
		$("#redo").addClass("disabled");
}

var undo = null;


function setCanvasCursor(name) {
	$("#canvas").removeClass (function (index, css) {
	    return (css.match (/\bcursor-\S+/g) || []).join(' ');
	}).addClass(name);
}

function snapDeltaToAngle(delta, snapAngle) {
	var angle = Math.atan2(delta.y, delta.x);
	angle = Math.round(angle/snapAngle) * snapAngle;
	var dirx = Math.cos(angle);
	var diry = Math.sin(angle);
	var d = dirx*delta.x + diry*delta.y;
	return new paper.Point(dirx*d, diry*d);
}

function indexFromAngle(angle) {
	var octant = Math.PI*2/8;
	var index = Math.round(angle/octant);
	if (index < 0) index += 8;
	return index % 8;
}

var oppositeCorner = {
	'top-left': 'bottom-right',
	'top-center': 'bottom-center',
	'top-right': 'bottom-left',
	'right-center': 'left-center',
	'bottom-right': 'top-left',
	'bottom-center': 'top-center',
	'bottom-left': 'top-right',
	'left-center': 'right-center',
};

function setCanvasRotateCursor(dir, da) {
	// zero is up, counter clockwise
	var angle = Math.atan2(dir.x, -dir.y) + da;
	var index = indexFromAngle(angle);
	var cursors = [
		'cursor-rotate-0',
		'cursor-rotate-45',
		'cursor-rotate-90',
		'cursor-rotate-135',
		'cursor-rotate-180',
		'cursor-rotate-225',
		'cursor-rotate-270',
		'cursor-rotate-315'
	];
	setCanvasCursor(cursors[index % 8]);
}

function setCanvasScaleCursor(dir) {
	// zero is up, counter clockwise
	var angle = Math.atan2(dir.x, -dir.y);
	var index = indexFromAngle(angle);
	var cursors = [
		'cursor-scale-0',
		'cursor-scale-45',
		'cursor-scale-90',
		'cursor-scale-135'
	];
	setCanvasCursor(cursors[index % 4]);
}

function dragRect(p1, p2) {
	// Create pixel perfect dotted rectable for drag selections.
	var half = new paper.Point(0.5 / paper.view.zoom, 0.5 / paper.view.zoom);
	var start = p1.add(half);
	var end = p2.add(half);
	var rect = new paper.CompoundPath();
	rect.moveTo(start);
	rect.lineTo(new paper.Point(start.x, end.y));
	rect.lineTo(end);
	rect.moveTo(start);
	rect.lineTo(new paper.Point(end.x, start.y));
	rect.lineTo(end);
	rect.strokeColor = 'black';
	rect.strokeWidth = 1.0 / paper.view.zoom;
	rect.dashOffset = 0.5 / paper.view.zoom;
	rect.dashArray = [1.0 / paper.view.zoom, 1.0 / paper.view.zoom];
	rect.removeOn({
		drag: true,
		up: true
	});
	rect.guide = true;
	return rect;
}

function findItemById(id) {
	if (id == -1) return null;
	function findItem(item) {
		if (item.id == id)
			return item;
		if (item.children) {
			for (var j = item.children.length-1; j >= 0; j--) {
				var it = findItem(item.children[j]);
				if (it != null)
					return it;
			}
		}
		return null;
	}

	for (var i = 0, l = paper.project.layers.length; i < l; i++) {
		var layer = paper.project.layers[i];
		var it = findItem(layer);
		if (it != null)
			return it;
	}
	return null;
}


var clipboard = null;

var selectionBounds = null;
var selectionBoundsShape = null;
var drawSelectionBounds = 0;

function clearSelectionBounds() {
	if (selectionBoundsShape)
		selectionBoundsShape.remove();
	selectionBoundsShape = null;
	selectionBounds = null;
};

function showSelectionBounds() {
	drawSelectionBounds++;
	if (drawSelectionBounds > 0) {
		if (selectionBoundsShape)
			selectionBoundsShape.visible = true;
	}
}

function hideSelectionBounds() {
	if (drawSelectionBounds > 0)
		drawSelectionBounds--;
	if (drawSelectionBounds == 0) {
		if (selectionBoundsShape)
			selectionBoundsShape.visible = false;
	}
}

function updateSelectionState() {
	clearSelectionBounds();
	selectionBounds = getSelectionBounds();
	if (selectionBounds != null) {
		var rect =  new paper.Path.Rectangle(selectionBounds);
		//var color = paper.project.activeLayer.getSelectedColor();
		rect.strokeColor = 'rgba(0,0,0,0)'; //color ? color : '#009dec';
		rect.strokeWidth = 1.0 / paper.view.zoom;
//		rect._boundsSelected = true;
		rect.selected = true;
		rect.setFullySelected(true);
		rect.guide = true;
		rect.visible = drawSelectionBounds > 0;
//		rect.transformContent = false;
		selectionBoundsShape = rect;
	}
	updateSelectionUI();
}

function updateSelectionUI() {
	if (selectionBounds == null) {
		$("#cut").addClass("disabled");
		$("#copy").addClass("disabled");
		$("#delete").addClass("disabled");
	} else {
		$("#cut").removeClass("disabled");
		$("#copy").removeClass("disabled");
		$("#delete").removeClass("disabled");
	}

	if (clipboard == null) {
		$("#paste").addClass("disabled");
	} else {
		$("#paste").removeClass("disabled");
	}
}

function cutSelection() {
	clipboard = captureSelectionState();
	var selected = paper.project.selectedItems;
	for (var i = 0; i < selected.length; i++) {
		selected[i].remove();
	}
	undo.snapshot("Cut");
}

function copySelection() {
	clipboard = captureSelectionState();
	updateSelectionState();
}

function pasteSelection() {
	if (clipboard == null)
		return;

	deselectAll();

	var items = [];
	for (var i = 0; i < clipboard.length; i++) {
		var content = clipboard[i];
		var item = paper.Base.importJSON(content.json);
		if (item) {
			item.selected = true;
			items.push(item);
		}
	}

	// Center pasted items to center of the view
	var bounds = null;
	for (var i = 0; i < items.length; i++) {
		if (bounds == null)
			bounds = items[i].bounds.clone();
		else
			bounds = bounds.unite(items[i].bounds);
	}
	if (bounds) {
		var delta = paper.view.center.subtract(bounds.center);
		for (var i = 0; i < items.length; i++) {
			items[i].position = items[i].position.add(delta);
		}
	}

	undo.snapshot("Paste");

	updateSelectionState();
	paper.project.view.update();
}

function deleteSelection() {
	var selected = paper.project.selectedItems;
	for (var i = 0; i < selected.length; i++) {
		selected[i].remove();
	}
	undo.snapshot("Delete");

	updateSelectionState();
	paper.project.view.update();
}

// Returns serialized contents of selected items. 
function captureSelectionState() {
	var originalContent = [];
	var selected = paper.project.selectedItems;
	for (var i = 0; i < selected.length; i++) {
		var item = selected[i];
		if (item.guide) continue;
		var orig = {
			id: item.id,
			json: paper.Base.serialize(item), // item.exportJSON();
			selectedSegments: []
		};
		originalContent.push(orig);
	}
	return originalContent;
}

// Restore the state of selected items.
function restoreSelectionState(originalContent) {
	// TODO: could use findItemById() instead.
	for (var i = 0; i < originalContent.length; i++) {
		var orig = originalContent[i];
		var item = findItemById(orig.id);
		if (!item) continue;
		// HACK: paper does not retain item IDs after importJSON,
		// store the ID here, and restore after deserialization.
		var id = item.id;
		item.importJSON(orig.json);
		item._id = id;
	}
}

function deselectAll() {
	paper.project.deselectAll();
}

function deselectAllPoints() {
	var selected = paper.project.selectedItems;
	for (var i = 0; i < selected.length; i++) {
		var item = selected[i];
		if (item instanceof paper.Path) {
			for (var j = 0; j < item.segments.length; j++)
				if (item.segments[j].selected)
					item.segments[j].selected = false;
		}
	}
}

// Returns path points which are contained in the rect. 
function getSegmentsInRect(rect) {
	var segments = [];

	function checkPathItem(item) {
		if (item._locked || !item._visible || item._guide)
			return;
		var children = item.children;
		if (!rect.intersects(item.bounds))
			return;
		if (item instanceof paper.Path) {
			for (var i = 0; i < item.segments.length; i++) {
				if (rect.contains(item.segments[i].point))
					segments.push(item.segments[i]);
			}
		} else {
			for (var j = children.length-1; j >= 0; j--)
				checkPathItem(children[j]);
		}
	}

	for (var i = paper.project.layers.length - 1; i >= 0; i--) {
		checkPathItem(paper.project.layers[i]);
	}

	return segments;
}

// Returns all items intersecting the rect.
// Note: only the item outlines are tested.
function getPathsIntersectingRect(rect) {
	var paths = [];
	var boundingRect = new paper.Path.Rectangle(rect);

	function checkPathItem(item) {
		var children = item.children;
		if (item.equals(boundingRect))
			return;
		if (!rect.intersects(item.bounds))
			return;
		if (item instanceof paper.PathItem) {
			if (rect.contains(item.bounds)) {
				paths.push(item);
				return;
			}
			var isects = boundingRect.getIntersections(item);
			if (isects.length > 0)
				paths.push(item);
		} else {
			for (var j = children.length-1; j >= 0; j--)
				checkPathItem(children[j]);
		}
	}

	for (var i = 0, l = paper.project.layers.length; i < l; i++) {
		var layer = paper.project.layers[i];
		checkPathItem(layer);
	}

	boundingRect.remove();

	return paths;
}

// Returns bounding box of all selected items.
function getSelectionBounds() {
	var bounds = null;
	var selected = paper.project.selectedItems;
	for (var i = 0; i < selected.length; i++) {
		if (bounds == null)
			bounds = selected[i].bounds.clone();
		else
			bounds = bounds.unite(selected[i].bounds);
	}
	return bounds;
}


var toolSelect = new paper.Tool();
toolSelect.mouseStartPos = new paper.Point();
toolSelect.mode = null;
toolSelect.hitItem = null;
toolSelect.originalContent = null;
toolSelect.changed = false;
toolSelect.duplicates = null;

toolSelect.createDuplicates = function(content) {
	this.duplicates = [];
	for (var key in content) {
		var json = content[key];
		var item = paper.Base.importJSON(json);
		if (item) {
			item.selected = false;
			this.duplicates.push(item);
		}
	}
};
toolSelect.removeDuplicates = function() {
	for (var i = 0; i < this.duplicates.length; i++)
		this.duplicates[i].remove();
	this.duplicates = null;
};

toolSelect.resetHot = function(type, event, mode) {
};
toolSelect.testHot = function(type, event, mode) {
/*	if (mode != 'tool-select')
		return false;*/
	return this.hitTest(event);
};
toolSelect.hitTest = function(event) {
	var hitSize = 4.0; // / paper.view.zoom;
	this.hitItem = null;

	// Hit test items.
	if (event.point)
		this.hitItem = paper.project.hitTest(event.point, { fill:true, stroke:true, tolerance: hitSize });

	if (this.hitItem) {
		if (this.hitItem.type == 'fill' || this.hitItem.type == 'stroke') {
			if (this.hitItem.item.selected) {
				setCanvasCursor('cursor-arrow-small');
			} else {
				setCanvasCursor('cursor-arrow-black-shape');
			}
		}
	} else {
		setCanvasCursor('cursor-arrow-black');
	}

	return true;
};
toolSelect.on({
	activate: function() {
		$("#tools").children().removeClass("selected");
		$("#tool-select").addClass("selected");
		setCanvasCursor('cursor-arrow-black');
		updateSelectionState();
		showSelectionBounds();
	},
	deactivate: function() {
		hideSelectionBounds();
	},
	mousedown: function(event) {
		this.mode = null;
		this.changed = false;

		if (this.hitItem) {
			if (this.hitItem.type == 'fill' || this.hitItem.type == 'stroke') {
				if (event.modifiers.shift) {
					this.hitItem.item.selected = !this.hitItem.item.selected;
				} else {
					if (!this.hitItem.item.selected)
						deselectAll();
					this.hitItem.item.selected = true;
				}
				if (this.hitItem.item.selected) {
					this.mode = 'move-shapes';
					deselectAllPoints();
					this.mouseStartPos = event.point.clone();
					this.originalContent = captureSelectionState();
				}
			}
			updateSelectionState();
		} else {
			// Clicked on and empty area, engage box select.
			this.mouseStartPos = event.point.clone();
			this.mode = 'box-select';
		}
	},
	mouseup: function(event) {
		if (this.mode == 'move-shapes') {
			if (this.changed) {
				clearSelectionBounds();
				undo.snapshot("Move Shapes");
			}
			this.duplicates = null;
		} else if (this.mode == 'box-select') {
			var box = new paper.Rectangle(this.mouseStartPos, event.point);

			if (!event.modifiers.shift)
				deselectAll();

			var selectedPaths = getPathsIntersectingRect(box);
			for (var i = 0; i < selectedPaths.length; i++)
				selectedPaths[i].selected = !selectedPaths[i].selected;
		}

		updateSelectionState();

		if (this.hitItem) {
			if (this.hitItem.item.selected) {
				setCanvasCursor('cursor-arrow-small');
			} else {
				setCanvasCursor('cursor-arrow-black-shape');
			}
		}
	},
	mousedrag: function(event) {
		if (this.mode == 'move-shapes') {

			this.changed = true;

			if (event.modifiers.option) {
				if (this.duplicates == null)
					this.createDuplicates(this.originalContent);
				setCanvasCursor('cursor-arrow-duplicate');
			} else {
				if (this.duplicates)
					this.removeDuplicates();
				setCanvasCursor('cursor-arrow-small');
			}

			var delta = event.point.subtract(this.mouseStartPos);
			if (event.modifiers.shift) {
				delta = snapDeltaToAngle(delta, Math.PI*2/8);
			}

			restoreSelectionState(this.originalContent);

			var selected = paper.project.selectedItems;
			for (var i = 0; i < selected.length; i++) {
				selected[i].position = selected[i].position.add(delta);
			}
			updateSelectionState();
		} else if (this.mode == 'box-select') {
			dragRect(this.mouseStartPos, event.point);
		}
	},
	mousemove: function(event) {
		this.hitTest(event);
	}
});


var toolDirectSelect = new paper.Tool();
toolDirectSelect.mouseStartPos = new paper.Point();
toolDirectSelect.mode = null;
toolDirectSelect.hitItem = null;
toolDirectSelect.originalContent = null;
toolDirectSelect.originalHandleIn = null;
toolDirectSelect.originalHandleOut = null;
toolDirectSelect.changed = false;

toolDirectSelect.resetHot = function(type, event, mode) {
};
toolDirectSelect.testHot = function(type, event, mode) {
	if (mode != 'tool-direct-select')
		return;
	return this.hitTest(event);
};

toolDirectSelect.hitTest = function(event) {
	var hitSize = 4.0; // / paper.view.zoom;
	var hit = null;
	this.hitItem = null;

	// Hit test items.
	if (event.point)
		this.hitItem = paper.project.hitTest(event.point, { fill:true, stroke:true, tolerance: hitSize });

	// Hit test selected handles
	hit = null;
	if (event.point)
		hit = paper.project.hitTest(event.point, { selected: true, handles: true, tolerance: hitSize });
	if (hit)
		this.hitItem = hit;
	// Hit test points
	hit = null;
	if (event.point)
		hit = paper.project.hitTest(event.point, { segments: true, tolerance: hitSize });
	if (hit)
		this.hitItem = hit;

	if (this.hitItem) {
		if (this.hitItem.type == 'fill' || this.hitItem.type == 'stroke') {
			if (this.hitItem.item.selected) {
				setCanvasCursor('cursor-arrow-small');
			} else {
				setCanvasCursor('cursor-arrow-white-shape');
			}
		} else if (this.hitItem.type == 'segment' || this.hitItem.type == 'handle-in' || this.hitItem.type == 'handle-out') {
			if (this.hitItem.segment.selected) {
				setCanvasCursor('cursor-arrow-small-point');
			} else {
				setCanvasCursor('cursor-arrow-white-point');
			}
		}
	} else {
		setCanvasCursor('cursor-arrow-white');
	}

	return true;
};
toolDirectSelect.on({
	activate: function() {
		$("#tools").children().removeClass("selected");
		$("#tool-direct-select").addClass("selected");
		setCanvasCursor('cursor-arrow-white');
//		this.hitItem = null;
	},
	deactivate: function() {
//		this.clearSelectionBounds();
	},
	mousedown: function(event) {
		this.mode = null;
		this.changed = false;

		if (this.hitItem) {
			if (this.hitItem.type == 'fill' || this.hitItem.type == 'stroke') {
				if (event.modifiers.shift) {
					this.hitItem.item.selected = !this.hitItem.item.selected;
				} else {
					if (!this.hitItem.item.selected)
						deselectAll();
					this.hitItem.item.selected = true;
				}
				if (this.hitItem.item.selected) {
					this.mode = 'move-shapes';
					deselectAllPoints();
					this.mouseStartPos = event.point.clone();
					this.originalContent = captureSelectionState();
				}
			} else if (this.hitItem.type == 'segment') {
				if (event.modifiers.shift) {
					this.hitItem.segment.selected = !this.hitItem.segment.selected;
				} else {
					if (!this.hitItem.segment.selected)
						deselectAllPoints();
					this.hitItem.segment.selected = true;
				}
				if (this.hitItem.segment.selected) {
					this.mode = 'move-points';
					this.mouseStartPos = event.point.clone();
					this.originalContent = captureSelectionState();
				}
			} else if (this.hitItem.type == 'handle-in' || this.hitItem.type == 'handle-out') {
				this.mode = 'move-handle';
				this.mouseStartPos = event.point.clone();
				this.originalHandleIn = this.hitItem.segment.handleIn.clone();
				this.originalHandleOut = this.hitItem.segment.handleOut.clone();

/*				if (this.hitItem.type == 'handle-out') {
					this.originalHandlePos = this.hitItem.segment.handleOut.clone();
					this.originalOppHandleLength = this.hitItem.segment.handleIn.length;
				} else {
					this.originalHandlePos = this.hitItem.segment.handleIn.clone();
					this.originalOppHandleLength = this.hitItem.segment.handleOut.length;
				}*/
//				this.originalContent = captureSelectionState(); // For some reason this does not work!
			}
			updateSelectionState();
		} else {
			// Clicked on and empty area, engage box select.
			this.mouseStartPos = event.point.clone();
			this.mode = 'box-select';
		}
	},
	mouseup: function(event) {
		if (this.mode == 'move-shapes') {
			if (this.changed) {
				clearSelectionBounds();
				undo.snapshot("Move Shapes");
			}
		} else if (this.mode == 'move-points') {
			if (this.changed) {
				clearSelectionBounds();
				undo.snapshot("Move Points");
			}
		} else if (this.mode == 'move-handle') {
			if (this.changed) {
				clearSelectionBounds();
				undo.snapshot("Move Handle");
			}
		} else if (this.mode == 'box-select') {
			var box = new paper.Rectangle(this.mouseStartPos, event.point);

			if (!event.modifiers.shift)
				deselectAll();

			var selectedSegments = getSegmentsInRect(box);
			if (selectedSegments.length > 0) {
				for (var i = 0; i < selectedSegments.length; i++) {
					selectedSegments[i].selected = !selectedSegments[i].selected;
				}
			} else {
				var selectedPaths = getPathsIntersectingRect(box);
				for (var i = 0; i < selectedPaths.length; i++)
					selectedPaths[i].selected = !selectedPaths[i].selected;
			}
		}

		updateSelectionState();

		if (this.hitItem) {
			if (this.hitItem.item.selected) {
				setCanvasCursor('cursor-arrow-small');
			} else {
				setCanvasCursor('cursor-arrow-white-shape');
			}
		}
	},
	mousedrag: function(event) {
		this.changed = true;
		if (this.mode == 'move-shapes') {
			setCanvasCursor('cursor-arrow-small');

			var delta = event.point.subtract(this.mouseStartPos);
			if (event.modifiers.shift) {
				delta = snapDeltaToAngle(delta, Math.PI*2/8);
			}
			restoreSelectionState(this.originalContent);

			var selected = paper.project.selectedItems;
			for (var i = 0; i < selected.length; i++) {
				selected[i].position = selected[i].position.add(delta);
			}
			updateSelectionState();
		} else if (this.mode == 'move-points') {
			setCanvasCursor('cursor-arrow-small');

			var delta = event.point.subtract(this.mouseStartPos);
			if (event.modifiers.shift) {
				delta = snapDeltaToAngle(delta, Math.PI*2/8);
			}
			restoreSelectionState(this.originalContent);

			var selected = paper.project.selectedItems;
			for (var i = 0; i < selected.length; i++) {
				var path = selected[i];
				for (var j = 0; j < path.segments.length; j++) {
					if (path.segments[j].selected)
						path.segments[j].point = path.segments[j].point.add(delta);
				}
			}
			updateSelectionState();
		} else if (this.mode == 'move-handle') {

			var delta = event.point.subtract(this.mouseStartPos);

			if (this.hitItem.type == 'handle-out') {
				var handlePos = this.originalHandleOut.add(delta);
				if (event.modifiers.shift) {
					handlePos = snapDeltaToAngle(handlePos, Math.PI*2/8);
				}
				this.hitItem.segment.handleOut = handlePos;
				this.hitItem.segment.handleIn = handlePos.normalize(-this.originalHandleIn.length);
			} else {
				var handlePos = this.originalHandleIn.add(delta);
				if (event.modifiers.shift) {
					handlePos = snapDeltaToAngle(handlePos, Math.PI*2/8);
				}
				this.hitItem.segment.handleIn = handlePos;
				this.hitItem.segment.handleOut = handlePos.normalize(-this.originalHandleOut.length);
			}

			updateSelectionState();
		} else if (this.mode == 'box-select') {
			dragRect(this.mouseStartPos, event.point);
		}
	},
	mousemove: function(event) {
		this.hitTest(event);
	}
});


var toolScale = new paper.Tool();
toolScale.mouseStartPos = new paper.Point();
toolScale.mode = null;
toolScale.hitItem = null;
toolScale.pivot = null;
toolScale.corner = null;
toolScale.originalCenter = null;
toolScale.originalSize = null;
toolScale.originalContent = null;
toolScale.changed = false;

toolScale.resetHot = function(type, event, mode) {
};
toolScale.testHot = function(type, event, mode) {
/*	if (mode != 'tool-select')
		return false;*/
	return this.hitTest(event);
};

toolScale.hitTest = function(event) {
	var hitSize = 6.0; // / paper.view.zoom;
	this.hitItem = null;

	if (!selectionBoundsShape || !selectionBounds)
		updateSelectionState();

	if (!selectionBoundsShape || !selectionBounds)
		return;

	// Hit test selection rectangle
	if (event.point)
		this.hitItem = selectionBoundsShape.hitTest(event.point, { bounds: true, guides: true, tolerance: hitSize });

	if (this.hitItem && this.hitItem.type == 'bounds') {
		// Normalize the direction so that corners are at 45° angles.
		var dir = event.point.subtract(selectionBounds.center);
		dir.x /= selectionBounds.width*0.5;
		dir.y /= selectionBounds.height*0.5;
		setCanvasScaleCursor(dir);
		return true;
	}

	return false;
};

toolScale.on({
	activate: function() {
		$("#tools").children().removeClass("selected");
		$("#tool-select").addClass("selected");
		setCanvasCursor('cursor-arrow-black');
		updateSelectionState();
		showSelectionBounds();
	},
	deactivate: function() {
		hideSelectionBounds();
	},
	mousedown: function(event) {
		this.mode = null;
		this.changed = false;
		if (this.hitItem) {
			if (this.hitItem.type == 'bounds') {
				this.originalContent = captureSelectionState();
				this.mode = 'scale';
				var pivotName = paper.Base.camelize(oppositeCorner[this.hitItem.name]);
				var cornerName = paper.Base.camelize(this.hitItem.name);
				this.pivot = selectionBounds[pivotName].clone();
				this.corner = selectionBounds[cornerName].clone();
				this.originalSize = this.corner.subtract(this.pivot);
				this.originalCenter = selectionBounds.center;
			}
			updateSelectionState();
		}
	},
	mouseup: function(event) {
		if (this.mode == 'scale') {
			if (this.changed) {
				clearSelectionBounds();
				undo.snapshot("Scale Shapes");
			}
		}
	},
	mousedrag: function(event) {
		if (this.mode == 'scale') {
			var pivot = this.pivot;
			var originalSize = this.originalSize;

			if (event.modifiers.option) {
				pivot = this.originalCenter;
				originalSize = originalSize.multiply(0.5);
			}

			this.corner = this.corner.add(event.delta);
			var size = this.corner.subtract(pivot);
			var sx = 1.0, sy = 1.0;
			if (Math.abs(originalSize.x) > 0.0000001)
				sx = size.x / originalSize.x;
			if (Math.abs(originalSize.y) > 0.0000001)
				sy = size.y / originalSize.y;

			if (event.modifiers.shift) {
				var signx = sx > 0 ? 1 : -1;
				var signy = sy > 0 ? 1 : -1;
				sx = sy = Math.max(Math.abs(sx), Math.abs(sy));
				sx *= signx;
				sy *= signy;
			}

			restoreSelectionState(this.originalContent);

			var selected = paper.project.selectedItems;
			for (var i = 0; i < selected.length; i++) {
				var item = selected[i];
				if (item.guide) continue; 
				item.scale(sx, sy, pivot);
			}
			updateSelectionState();
			this.changed = true;
		}
	},
	mousemove: function(event) {
		this.hitTest(event);
	}
});


var toolRotate = new paper.Tool();
toolRotate.mouseStartPos = new paper.Point();
toolRotate.mode = null;
toolRotate.hitItem = null;
toolRotate.originalCenter = null;
toolRotate.originalAngle = 0;
toolRotate.originalContent = null;
toolRotate.originalShape = null;
toolRotate.cursorDir = null;
toolRotate.changed = false;


toolRotate.resetHot = function(type, event, mode) {
};
toolRotate.testHot = function(type, event, mode) {
/*	if (mode != 'tool-select')
		return false;*/
	return this.hitTest(event);
};

toolRotate.hitTest = function(event) {
	var hitSize = 12.0; // / paper.view.zoom;
	this.hitItem = null;

	if (!selectionBoundsShape || !selectionBounds)
		updateSelectionState();

	if (!selectionBoundsShape || !selectionBounds)
		return;

	// Hit test selection rectangle
	this.hitItem = null;
	if (event.point && !selectionBounds.contains(event.point))
		this.hitItem = selectionBoundsShape.hitTest(event.point, { bounds: true, guides: true, tolerance: hitSize });

	if (this.hitItem && this.hitItem.type == 'bounds') {
		// Normalize the direction so that corners are at 45° angles.
		var dir = event.point.subtract(selectionBounds.center);
		dir.x /= selectionBounds.width*0.5;
		dir.y /= selectionBounds.height*0.5;
		setCanvasRotateCursor(dir, 0);
		toolRotate.cursorDir = dir;
		return true;
	}

	return false;
};

toolRotate.on({
	activate: function() {
		$("#tools").children().removeClass("selected");
		$("#tool-select").addClass("selected");
		setCanvasCursor('cursor-arrow-black');
		updateSelectionState();
		showSelectionBounds();
	},
	deactivate: function() {
		hideSelectionBounds();
	},
	mousedown: function(event) {
		this.mode = null;
		this.changed = false;
		if (this.hitItem) {
			if (this.hitItem.type == 'bounds') {
				this.originalContent = captureSelectionState();
				this.originalShape = paper.Base.serialize(selectionBoundsShape);

				this.mode = 'rotate';
//				var pivotName = paper.Base.camelize(oppositeCorner[this.hitItem.name]);
//				var cornerName = paper.Base.camelize(this.hitItem.name);
//				this.corner = selectionBounds[cornerName].clone();
				this.originalCenter = selectionBounds.center.clone();
				var delta = event.point.subtract(this.originalCenter);
				this.originalAngle = Math.atan2(delta.y, delta.x);
			}
			updateSelectionState();
		}
	},
	mouseup: function(event) {
		if (this.mode == 'rotate') {
			if (this.changed) {
				clearSelectionBounds();
				undo.snapshot("Rotate Shapes");
			}
		}
		updateSelectionState();
	},
	mousedrag: function(event) {
		if (this.mode == 'rotate') {

			var delta = event.point.subtract(this.originalCenter);
			var angle = Math.atan2(delta.y, delta.x);
			var da = angle - this.originalAngle;

			if (event.modifiers.shift) {
				var snapeAngle = Math.PI/4;
				da = Math.round(da / snapeAngle) * snapeAngle;
			}

			restoreSelectionState(this.originalContent);

			var id = selectionBoundsShape.id;
			selectionBoundsShape.importJSON(this.originalShape);
			selectionBoundsShape._id = id;

			var deg = da/Math.PI*180;

			selectionBoundsShape.rotate(deg, this.originalCenter);

			var selected = paper.project.selectedItems;
			for (var i = 0; i < selected.length; i++) {
				var item = selected[i];
				if (item.guide) continue;
				item.rotate(deg, this.originalCenter);
			}

			setCanvasRotateCursor(toolRotate.cursorDir, da);
			this.changed = true;
		}
	},
	mousemove: function(event) {
		this.hitTest(event);
	}
});


var toolZoomPan = new paper.Tool();
toolZoomPan.distanceThreshold = 8;
toolZoomPan.mouseStartPos = new paper.Point();
toolZoomPan.mode = 'pan';
toolZoomPan.zoomFactor = 1.3;
toolZoomPan.resetHot = function(type, event, mode) {
};
toolZoomPan.testHot = function(type, event, mode) {
	var spacePressed = event && event.modifiers.space;
	if (mode != 'tool-zoompan' && !spacePressed)
		return false;
	return this.hitTest(event);
};
toolZoomPan.hitTest = function(event) {
	if (event.modifiers.command) {
		if (event.modifiers.command && !event.modifiers.option) {
			setCanvasCursor('cursor-zoom-in');
		} else if (event.modifiers.command && event.modifiers.option) {
			setCanvasCursor('cursor-zoom-out');
		}
	} else {
		setCanvasCursor('cursor-hand');
	}
	return true;
};
toolZoomPan.on({
	activate: function() {
		$("#tools").children().removeClass("selected");
		$("#tool-zoompan").addClass("selected");
		setCanvasCursor('cursor-hand');
	},
	deactivate: function() {
	},
	mousedown: function(event) {
		this.mouseStartPos = event.point.subtract(paper.view.center);
		this.mode = '';
		if (event.modifiers.command) {
			this.mode = 'zoom';
		} else {
			setCanvasCursor('cursor-hand-grab');
			this.mode = 'pan';
		}
	},
	mouseup: function(event) {
		if (this.mode == 'zoom') {
			var zoomCenter = event.point.subtract(paper.view.center);
			var moveFactor = this.zoomFactor - 1.0;
			if (event.modifiers.command && !event.modifiers.option) {
				paper.view.zoom *= this.zoomFactor;
				paper.view.center = paper.view.center.add(zoomCenter.multiply(moveFactor / this.zoomFactor));
			} else if (event.modifiers.command && event.modifiers.option) {
				paper.view.zoom /= this.zoomFactor;
				paper.view.center = paper.view.center.subtract(zoomCenter.multiply(moveFactor));
			}
		} else if (this.mode == 'zoom-rect') {
			var start = paper.view.center.add(this.mouseStartPos);
			var end = event.point;
			paper.view.center = start.add(end).multiply(0.5);
			var dx = paper.view.bounds.width / Math.abs(end.x - start.x);
			var dy = paper.view.bounds.height / Math.abs(end.y - start.y);
			paper.view.zoom = Math.min(dx, dy) * paper.view.zoom;
		}
		this.hitTest(event);
		this.mode = '';
	},
	mousedrag: function(event) {
		if (this.mode == 'zoom') {
			// If dragging mouse while in zoom mode, switch to zoom-rect instead.
			this.mode = 'zoom-rect';
		} else if (this.mode == 'zoom-rect') {
			// While dragging the zoom rectangle, paint the selected area.
			dragRect(paper.view.center.add(this.mouseStartPos), event.point);
		} else if (this.mode == 'pan') {
			// Handle panning by moving the view center.
			var pt = event.point.subtract(paper.view.center);
			var delta = this.mouseStartPos.subtract(pt);
			paper.view.scrollBy(delta);
			this.mouseStartPos = pt;
		}
	},

	mousemove: function(event) {
		this.hitTest(event);
	},

	keydown: function(event) {
		this.hitTest(event);
	},

	keyup: function(event) {
		this.hitTest(event);
	}
});

var toolPen = new paper.Tool();
toolPen.pathId = -1;
toolPen.hitResult = null;
toolPen.mouseStartPos = null;
toolPen.originalHandleIn = null;
toolPen.originalHandleOut = null;
toolPen.currentSegment = null;

toolPen.closePath = function() {
	if (this.pathId != -1) {
		deselectAllPoints();
		this.pathId = -1;
	}
};
toolPen.updateTail = function(point) {
	var path = findItemById(this.pathId);
	if (path == null)
		return;
	var nsegs = path.segments.length;
	if (nsegs == 0)
		return;

	var color = paper.project.activeLayer.getSelectedColor();
	var tail = new paper.Path();
	tail.strokeColor = color ? color : '#009dec';
	tail.strokeWidth = 1.0 / paper.view.zoom;
	tail.guide = true;

	var prevPoint = path.segments[nsegs-1].point;
	var prevHandleOut = path.segments[nsegs-1].point.add(path.segments[nsegs-1].handleOut);

	tail.moveTo(prevPoint);
	tail.cubicCurveTo(prevHandleOut, point, point);
	
	tail.removeOn({
		drag: true,
		up: true,
		down: true,
		move: true
	});
}
toolPen.resetHot = function(type, event, mode) {
};
toolPen.testHot = function(type, event, mode) {
	if (mode != 'tool-pen')
		return false;
	if (event.modifiers.command)
		return false;
	if (type == 'keyup') {
		if (event.key == 'enter' || event.key == 'escape') {
			this.closePath();
		}
	}
	return this.hitTest(event, type);
};
toolPen.hitTest = function(event, type) {
	var hitSize = 4.0; // / paper.view.zoom;
	var result = null;
//	var isKeyEvent = type == 'mode' || type == 'command' || type == 'keydown' || type == 'keyup';

	this.currentSegment = null;
	this.hitResult = null;

	if (event.point)
		result = paper.project.hitTest(event.point, { segments: true, stroke: true, tolerance: hitSize });

	if (result) {
		if (result.type == 'stroke') {
			if (result.item.selected) {
				// Insert point.
				this.mode = 'insert';
				setCanvasCursor('cursor-pen-add');
			} else {
				result = null;
			} 
		} else if (result.type == 'segment') {
			var last = result.item.segments.length-1;
			if (!result.item.closed && (result.segment.index == 0 || result.segment.index == last)) {
				if (result.item.id == this.pathId) {
					if (result.segment.index == 0) {
						// Close
						this.mode = 'close';
						setCanvasCursor('cursor-pen-close');
						this.updateTail(result.segment.point);
					} else {
						// Adjust last handle
						this.mode = 'adjust';
						setCanvasCursor('cursor-pen-adjust');
					}
				} else {
					if (this.pathId != -1) {
						this.mode = 'join';
						setCanvasCursor('cursor-pen-join');
						this.updateTail(result.segment.point);
					} else {
						this.mode = 'continue';
						setCanvasCursor('cursor-pen-edit');
					}
				}
			} else if (result.item.selected) {
				if (event.modifiers.option) {
					this.mode = 'convert';
					setCanvasCursor('cursor-pen-adjust');
				} else {
					this.mode = 'remove';
					setCanvasCursor('cursor-pen-remove');
				}
			} else {
				result = null;
			}
		}
	}

	if (!result) {
		this.mode = 'create';
		setCanvasCursor('cursor-pen-create');
		if (event.point)
			this.updateTail(event.point);
	}

	this.hitResult = result;

	return true;
};
toolPen.on({
	activate: function() {
		$("#tools").children().removeClass("selected");
		$("#tool-pen").addClass("selected");
		setCanvasCursor('cursor-pen-add');
	},
	deactivate: function() {
		if (toolStack.mode != 'tool-pen') {
			this.closePath();
			updateSelectionState();
		}
		this.currentSegment = null;
	},
	mousedown: function(event) {

		deselectAllPoints();

		if (this.mode == 'create') {
			var path = findItemById(this.pathId);
			if (path == null) {
				deselectAll();
				path = new paper.Path();
				path.strokeColor = 'black';
				this.pathId = path.id;
			}
			this.currentSegment = path.add(event.point);

			this.mouseStartPos = event.point.clone();
			this.originalHandleIn = this.currentSegment.handleIn.clone();
			this.originalHandleOut = this.currentSegment.handleOut.clone();

		} else if (this.mode == 'insert') {
			if (this.hitResult != null) {
				var location = this.hitResult.location;

				var values = location.curve.getValues();
				var isLinear = location.curve.isLinear();
				var parts = paper.Curve.subdivide(values, location.parameter);
				var left = parts[0];
				var right = parts[1];

				var x = left[6], y = left[7];
				var segment = new Segment(new paper.Point(x, y),
					!isLinear && new paper.Point(left[4] - x, left[5] - y),
					!isLinear && new paper.Point(right[2] - x, right[3] - y));

				var seg = this.hitResult.item.insert(location.index + 1, segment);

				if (!isLinear) {
					seg.previous.handleOut.set(left[2] - left[0], left[3] - left[1]);
					seg.next.handleIn.set(right[4] - right[6], right[5] - right[7]);
				}

				deselectAllPoints();
				seg.selected = true;

				this.hitResult = null;
			}

		} else if (this.mode == 'close') {

			if (this.pathId != -1) {
				var path = findItemById(this.pathId);
				path.closed = true;
			}

			this.currentSegment = this.hitResult.segment;
			this.currentSegment.handleIn.set(0,0);

			this.mouseStartPos = event.point.clone();
			this.originalHandleIn = this.currentSegment.handleIn.clone();
			this.originalHandleOut = this.currentSegment.handleOut.clone();

		} else if (this.mode == 'adjust') {

			this.currentSegment = this.hitResult.segment;
			this.currentSegment.handleOut.set(0,0);

			this.mouseStartPos = event.point.clone();
			this.originalHandleIn = this.currentSegment.handleIn.clone();
			this.originalHandleOut = this.currentSegment.handleOut.clone();

		} else if (this.mode == 'continue') {

			if (this.hitResult.segment.index == 0)
				this.hitResult.item.reverse();

			this.pathId = this.hitResult.item.id;
			this.currentSegment = this.hitResult.segment;
			this.currentSegment.handleOut.set(0,0);

			this.mouseStartPos = event.point.clone();
			this.originalHandleIn = this.currentSegment.handleIn.clone();
			this.originalHandleOut = this.currentSegment.handleOut.clone();

		} else if (this.mode == 'convert') {

			this.pathId = this.hitResult.item.id;
			this.currentSegment = this.hitResult.segment;
			this.currentSegment.handleIn.set(0,0);
			this.currentSegment.handleOut.set(0,0);

			this.mouseStartPos = event.point.clone();
			this.originalHandleIn = this.currentSegment.handleIn.clone();
			this.originalHandleOut = this.currentSegment.handleOut.clone();

		} else if (this.mode == 'join') {

			var path = findItemById(this.pathId);
			if (path != null) {
				var oldPoint = this.hitResult.segment.point.clone();
				if (this.hitResult.segment.index != 0)
					this.hitResult.item.reverse();
				path.join(this.hitResult.item);
				// Find nearest point to the hit point.
				var imin = -1;
				var dmin = 0;
				for (var i = 0; i < path.segments.length; i++) {
					var d = oldPoint.getDistance(path.segments[i].point);
					if (imin == -1 || d < dmin) {
						dmin = d;
						imin = i;
					}
				}
				this.currentSegment = path.segments[imin];
				this.currentSegment.handleIn.set(0,0);

				this.mouseStartPos = event.point.clone();
				this.originalHandleIn = this.currentSegment.handleIn.clone();
				this.originalHandleOut = this.currentSegment.handleOut.clone();
			} else {
				this.currentSegment = -1;	
			}

		} else if (this.mode == 'remove') {
			if (this.hitResult != null) {
				this.hitResult.item.removeSegment(this.hitResult.segment.index);
				this.hitResult = null;
			}
		}

		if (this.currentSegment)
			this.currentSegment.selected = true;
	},
	mouseup: function(event) {
		if (this.mode == 'close') {
			this.closePath();
		} else if (this.mode == 'join') {
			this.closePath();
		} else if (this.mode == 'convert') {
			this.closePath();
		}
		undo.snapshot("Pen");
		this.mode = null;
		this.currentSegment = null;
	},
	mousedrag: function(event) {
		if (this.currentSegment == null)
			return;
		var path = findItemById(this.pathId);
		if (path == null)
			return;

		var dragIn = false;
		var dragOut = false;
		var invert = false;

		if (this.mode == 'create') {
			dragOut = true;
			if (this.currentSegment.index > 0)
				dragIn = true;
		} else  if (this.mode == 'close') {
			dragIn = true;
			invert = true;
		} else  if (this.mode == 'continue') {
			dragOut = true;
		} else if (this.mode == 'adjust') {
			dragOut = true;
		} else  if (this.mode == 'join') {
			dragIn = true;
			invert = true;
		} else  if (this.mode == 'convert') {
			dragIn = true;
			dragOut = true;
		}

		if (dragIn || dragOut) {
			var delta = event.point.subtract(this.mouseStartPos);
			if (invert)
				delta = delta.negate();
			if (dragIn && dragOut) {
				var handlePos = this.originalHandleOut.add(delta);
				if (event.modifiers.shift)
					handlePos = snapDeltaToAngle(handlePos, Math.PI*2/8);
				this.currentSegment.handleOut = handlePos;
				this.currentSegment.handleIn = handlePos.negate();
			} else if (dragOut) {
				var handlePos = this.originalHandleOut.add(delta);
				if (event.modifiers.shift)
					handlePos = snapDeltaToAngle(handlePos, Math.PI*2/8);
				this.currentSegment.handleOut = handlePos;
				this.currentSegment.handleIn = handlePos.normalize(-this.originalHandleIn.length);
			} else {
				var handlePos = this.originalHandleIn.add(delta);
				if (event.modifiers.shift)
					handlePos = snapDeltaToAngle(handlePos, Math.PI*2/8);
				this.currentSegment.handleIn = handlePos;
				this.currentSegment.handleOut = handlePos.normalize(-this.originalHandleOut.length);
			}
		}

	},
	mousemove: function(event) {
		this.hitTest(event);
	}
});


var toolStack = new paper.Tool();
toolStack.stack = [
	toolZoomPan,
	toolPen,
	toolScale,
	toolRotate,
	toolDirectSelect,
	toolSelect
];
toolStack.hotTool = null;
toolStack.activeTool = null;
toolStack.lastPoint = new paper.Point();
toolStack.command = function(cb) {
	if (this.activeTool != null)
		return;
/*	if (this.hotTool) {
		this.hotTool.fire('deactivate');
		this.hotTool = null;
	}*/
	if (cb) cb();
	var event = new paper.Event();
	event.point = this.lastPoint.clone();
	this.testHot('command', event);
};
toolStack.setToolMode = function(mode) {
	this.mode = mode;
	var event = new paper.Event();
	event.point = this.lastPoint.clone();
	this.testHot('mode', event);
};
toolStack.testHot = function(type, event) {
	// Reset the state of the tool before testing.
	var prev = this.hotTool;
	this.hotTool = null;
	for (var i = 0; i < this.stack.length; i++)
		this.stack[i].resetHot(type, event, this.mode);
	// Pick the first hot tool.
	for (var i = 0; i < this.stack.length; i++) {
		if (this.stack[i].testHot(type, event, this.mode)) {
			this.hotTool = this.stack[i];
			break;
		}
	}
	if (prev != this.hotTool) {
		if (prev)
			prev.fire('deactivate');
		if (this.hotTool)
			this.hotTool.fire('activate');
	}
};
toolStack.on({
	activate: function() {
		this.activeTool = null;
		this.hotTool = null;
	},

	deactivate: function() {
		this.activeTool = null;
		this.hotTool = null;
	},

	mousedown: function(event) {
		this.lastPoint = event.point.clone();
		if (this.hotTool) {
			this.activeTool = this.hotTool;
			this.activeTool.fire('mousedown', event);
		}
	},

	mouseup: function(event) {
		this.lastPoint = event.point.clone();
		if (this.activeTool)
			this.activeTool.fire('mouseup', event);
		this.activeTool = null;
		this.testHot('mouseup', event);
	},

	mousedrag: function(event) {
		this.lastPoint = event.point.clone();
		if (this.activeTool)
			this.activeTool.fire('mousedrag', event);
	},

	mousemove: function(event) {
		this.lastPoint = event.point.clone();
		this.testHot('mousemove', event);
	},

	keydown: function(event) {
		event.point = this.lastPoint.clone();
		if (this.activeTool)
			this.activeTool.fire('keydown', event);
		else
			this.testHot('keydown', event);
	},

	keyup: function(event) {
		event.point = this.lastPoint.clone();
		if (this.activeTool)
			this.activeTool.fire('keyup', event);
		else
			this.testHot('keyup', event);
	}
});


$(document).ready(function() {
	var $canvas = $('#canvas');
	paper.setup($canvas[0]);

	// HACK: Do not select the children of layers, or else
	// the layers of selected objects will become selected
	// after importJSON(). 
	paper.Layer.inject({ 
		_selectChildren: false 
	});

	undo = new Undo(20);

	var path1 = new paper.Path.Circle(new paper.Point(180, 50), 30);
	path1.strokeColor = 'black';
	var path2 = new paper.Path.Circle(new paper.Point(180, 150), 20);
	path2.fillColor = 'grey';

	undo.snapshot("Init");

	$("#tool-select").click(function() {
		toolStack.setToolMode('tool-select');
	});
	$("#tool-direct-select").click(function() {
		toolStack.setToolMode('tool-direct-select');
	});
	$("#tool-pen").click(function() {
		toolStack.setToolMode('tool-pen');
	});
	$("#tool-zoompan").click(function() {
		toolStack.setToolMode('tool-zoompan');
	});

	$("#undo").click(function() {
		toolStack.command(function() {
			if (undo.canUndo())
				undo.undo();
		});
	});
	$("#redo").click(function() {
		toolStack.command(function() {
			if (undo.canRedo())
				undo.redo();
		});
	});

	$("#cut").click(function() {
		cutSelection();
	});
	$("#copy").click(function() {
		copySelection();
	});
	$("#paste").click(function() {
		pasteSelection();
	});

	$("#delete").click(function() {
		deleteSelection();
	});

	toolStack.activate();
	toolStack.setToolMode('tool-select');

	paper.view.draw();
});
