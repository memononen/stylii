var Base = paper.Base,
	PaperScope = paper.PaperScope,
	Item = paper.Item,
	Path = paper.Path,
	PathItem = paper.PathItem,
	CompoundPath = paper.CompoundPath,
	Group = paper.Group,
	Layer = paper.Layer,
	Segment = paper.Segment,
	Raster = paper.Raster,
	Tool = paper.Tool,
	Component = paper.Component,
	Point = paper.Point,
	Rectangle = paper.Rectangle,
	Matrix = paper.Matrix,
	Size = paper.Size;


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
	var json = Base.serialize(paper.project); //paper.project.exportJSON();
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
		if (item instanceof Path) {
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
	// HACK: some logic in Paper.js prevents deselectAll in some cases.
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

Undo.prototype.restore = function(state) {
	paper.project.clear();
	paper.project.importJSON(state.json);
	this.restoreIDs();

	this.restoreSelection(state.selection);

	updateSelectionState();

	paper.project.view.update();
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
	return new Point(dirx*d, diry*d);
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
/*	var angles = {
		'top-left': 315,
		'top-center': 0,
		'top-right': 45,
		'right-center': 90,
		'bottom-right': 135,
		'bottom-center': 180,
		'bottom-left': 225,
		'left-center': 270,
	};*/
//	console.log("corner="+corner);
//	var angle = angles[corner] || 0;
// angle *= Math.PI/180;
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
/*	var angles = {
		'top-left': 315,
		'top-center': 0,
		'top-right': 45,
		'right-center': 90,
		'bottom-right': 135,
		'bottom-center': 180,
		'bottom-left': 225,
		'left-center': 270,
	};*/
//	console.log("corner="+corner);
//	var angle = angles[corner] || 0;
// angle *= Math.PI/180;
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
	var half = new Point(0.5 / paper.view.zoom, 0.5 / paper.view.zoom);
	var start = p1.add(half);
	var end = p2.add(half);
	var rect = new CompoundPath();
	rect.moveTo(start);
	rect.lineTo(new Point(start.x, end.y));
	rect.lineTo(end);
	rect.moveTo(start);
	rect.lineTo(new Point(end.x, start.y));
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
		var rect =  new Path.Rectangle(selectionBounds);
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
}

function captureSelectionState() {
	var originalContent = {};
	var selected = paper.project.selectedItems;
//	console.log("capture:")
	for (var i = 0; i < selected.length; i++) {
		var item = selected[i];
		if (item.guide) continue;
//		this.scale.originalContent[item.id] = item.exportJSON();
		originalContent[item.id] = Base.serialize(item);
//		console.log(" - "+item.id+" json:"+originalContent[item.id]);
		// Store segment selection
		if (item instanceof Path) {
			var segs = [];
			for (var j = 0; j < item.segments.length; j++) {
				if (item.segments[j].selected)
					segs.push(item.segments[j].index);
			}
			if (segs.length > 0) {
				originalContent[item.id+"-selected-segments"] = segs;
			}
		}
	}
	return originalContent;
}

function restoreSelectionState(originalContent) {
	var selected = paper.project.selectedItems;
//	console.log("restore:")
	for (var i = 0; i < selected.length; i++) {
		var item = selected[i];
		if (item.guide) continue;
		if (originalContent.hasOwnProperty(item.id)) {
			var id = item.id;
			var json = originalContent[item.id];
//			console.log(" - "+id+" json:"+json);
			item.importJSON(json);
			item._id = id;
		}
		// Restore segment selection
		if (item instanceof Path) {
			var key = item.id+"-selected-segments";
			if (originalContent.hasOwnProperty(key)) {
				var segs = originalContent[key];
				for (var j = 0; j < segs.length; j++) {
					var idx = segs[j];
					if (idx >= 0 && idx < item.segments.length)
						item.segments[idx].selected = true;
				}
			}
		}

	}
}

function deselectAll() {
	paper.project.deselectAll();
}

function deselectAllPoints() {
	var selected = paper.project.selectedItems;
	for (var i = 0; i < selected.length; i++) {
		var item = selected[i];
		if (item instanceof Path) {
			for (var j = 0; j < item.segments.length; j++)
				if (item.segments[j].selected)
					item.segments[j].selected = false;
		}
	}
}

function getSegmentsInRect(rect) {
	var segments = [];

	function checkPathItem(item) {
		if (item._locked || !item._visible || item._guide)
			return;
		var children = item.children;
		if (!rect.intersects(item.bounds))
			return;
		if (item instanceof Path) {
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

function getPathsIntersectingRect(rect) {
	var paths = [];
	var boundingRect = new Path.Rectangle(rect);

	function checkPathItem(item) {
		var children = item.children;
		if (item.equals(boundingRect))
			return;
		if (!rect.intersects(item.bounds))
			return;
		if (item instanceof PathItem) {
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


var toolSelect = new Tool();
toolSelect.mouseStartPos = new Point();
toolSelect.mode = null;
toolSelect.hitItem = null;
toolSelect.originalContent = null;
toolSelect.changed = false;
toolSelect.resetHot = function(type, event, mode) {
};
toolSelect.testHot = function(type, event, mode) {
	if (mode != 'tool-select')
		return;
	return this.hitTest(event);
};
toolSelect.hitTest = function(event) {
	var hitSize = 4.0 / paper.view.zoom;

	// Hit test items.
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
		} else if (this.mode == 'box-select') {
			var box = new Rectangle(this.mouseStartPos, event.point);

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
		} else if (this.mode == 'box-select') {
			dragRect(this.mouseStartPos, event.point);
		}
	},
	mousemove: function(event) {
		this.hitTest(event);
	}
});


var toolDirectSelect = new Tool();
toolDirectSelect.mouseStartPos = new Point();
toolDirectSelect.mode = null;
toolDirectSelect.hitItem = null;
toolDirectSelect.originalContent = null;
toolDirectSelect.originalHandlePos = null;
toolDirectSelect.changed = false;

toolDirectSelect.resetHot = function(type, event, mode) {
};
toolDirectSelect.testHot = function(type, event, mode) {
	if (mode != 'tool-direct-select')
		return;
	return this.hitTest(event);
};

toolDirectSelect.hitTest = function(event) {
	var hitSize = 4.0 / paper.view.zoom;

	// Hit test items.
	this.hitItem = paper.project.hitTest(event.point, { fill:true, stroke:true, tolerance: hitSize });

	// Hit test selected handles
	var hit = paper.project.hitTest(event.point, { selected: true, handles: true, tolerance: hitSize });
	if (hit) {
		this.hitItem = hit;
	}
	// Hit test points
	var hit = paper.project.hitTest(event.point, { segments: true, tolerance: hitSize });
	if (hit) {
		this.hitItem = hit;
	}

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
				if (this.hitItem.type == 'handle-out')
					this.originalHandlePos = this.hitItem.segment.handleOut.clone();
				else
					this.originalHandlePos = this.hitItem.segment.handleIn.clone();
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
			var box = new Rectangle(this.mouseStartPos, event.point);

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

//			restoreSelectionState(this.originalContent);

			if (this.hitItem.type == 'handle-out') {
				var handlePos = this.originalHandlePos.add(delta);
				if (event.modifiers.shift) {
					handlePos = snapDeltaToAngle(handlePos, Math.PI*2/8);
				}
				this.hitItem.segment.handleOut = handlePos;
				this.hitItem.segment.handleIn = handlePos.negate();
			} else {
				var handlePos = this.originalHandlePos.add(delta);
				if (event.modifiers.shift) {
					handlePos = snapDeltaToAngle(handlePos, Math.PI*2/8);
				}
				this.hitItem.segment.handleIn = handlePos;
				this.hitItem.segment.handleOut = handlePos.negate();
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


var toolScale = new Tool();
toolScale.mouseStartPos = new Point();
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
	if (mode != 'tool-select')
		return false;
	return this.hitTest(event);
};

toolScale.hitTest = function(event) {
	var hitSize = 6.0 / paper.view.zoom;

	this.hitItem = null;

	if (!selectionBoundsShape || !selectionBounds)
		updateSelectionState();

	if (!selectionBoundsShape || !selectionBounds)
		return;

	// Hit test selection rectangle
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


var toolRotate = new Tool();
toolRotate.mouseStartPos = new Point();
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
	if (mode != 'tool-select')
		return false;
	return this.hitTest(event);
};

toolRotate.hitTest = function(event) {
	var hitSize = 12.0 / paper.view.zoom;

	this.hitItem = null;

	if (!selectionBoundsShape || !selectionBounds)
		updateSelectionState();

	if (!selectionBoundsShape || !selectionBounds)
		return;

	// Hit test selection rectangle
	this.hitItem = null;
	if (!selectionBounds.contains(event.point))
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
				this.originalShape = Base.serialize(selectionBoundsShape);

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


var toolZoomPan = new Tool();
toolZoomPan.distanceThreshold = 8;
toolZoomPan.mouseStartPos = new Point();
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

var toolPen = new Tool();
toolPen.path = null;
toolPen.clearHandles = false;
toolPen.hoverSegment = null;
toolPen.currentSegment = null;
toolPen.closePath = function() {
	if (this.path != null) {
		deselectAllPoints();
		this.path = null;
	}
};
toolPen.updateTail = function(point, close) {
	if (this.path == null)
		return;
	var nsegs = this.path.segments.length;
	if (nsegs == 0)
		return;

	var color = paper.project.activeLayer.getSelectedColor();
	var tail = new Path();
	tail.strokeColor = color ? color : '#009dec';
	tail.strokeWidth = 1.0 / paper.view.zoom;

	var prevPoint = this.path.segments[nsegs-1].point;
	var prevHandleOut = this.path.segments[nsegs-1].point.add(this.path.segments[nsegs-1].handleOut);

	tail.moveTo(prevPoint);
	if (close) {
		var curPoint = this.path.segments[0].point;
		var curHandleIn = this.path.segments[0].point.add(this.path.segments[0].handleIn);
		tail.cubicCurveTo(prevHandleOut, curHandleIn, curPoint);
	} else {
		tail.cubicCurveTo(prevHandleOut, point, point);
	}
	
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
	if (type == 'keyup') {
		if (event.key == 'enter' || event.key == 'escape') {
			this.closePath();
		}
	}
	return this.hitTest(event);
};
toolPen.hitTest = function(event) {
	this.mode = 'add';
	this.hoverSegment = null;
	if (this.path) {
		var hitSize = 4.0 / paper.view.zoom;
		var result = this.path.hitTest(event.point, { segments: true, handles: true, tolerance: hitSize });
		if (result) {
			this.mode = 'move';
			this.type = result.type;
			this.hoverSegment = result.segment;

			if (this.path.segments.length > 1 && result.type == 'segment' && result.segment.index == 0) {
				this.mode = 'close';
				setCanvasCursor('cursor-pen-close');
				this.updateTail(event.point, true);
			} else {

				if (result.type == 'segment')
					setCanvasCursor('cursor-arrow-small-point');
				else if (result.type == 'handle-in')
					setCanvasCursor('cursor-arrow-small-point');
				else if (result.type == 'handle-out')
					setCanvasCursor('cursor-arrow-small-point');
				else
					setCanvasCursor('cursor-pen-edit');
			}
		} else {
			setCanvasCursor('cursor-pen-add');
			this.updateTail(event.point, false);
		}
	} else {
		setCanvasCursor('cursor-pen-add');
	}
	return true;
};
toolPen.on({
	activate: function() {
		$("#tools").children().removeClass("selected");
		$("#tool-pen").addClass("selected");
		setCanvasCursor('cursor-pen-add');
	},
	deactivate: function() {
		this.closePath();
	},
	mousedown: function(event) {
		if (this.currentSegment)
			this.currentSegment.selected = false;

		if (this.mode == 'add') {
			if (!this.path) {
				deselectAll();
				this.path = new Path();
				this.path.strokeColor = 'black';
			}
			this.currentSegment = this.path.add(event.point);
		} else if (this.mode == 'close') {
			this.currentSegment = this.hoverSegment;
			if (this.path)
				this.path.closed = true;
			this.clearHandles = true;
		} else if (this.mode == 'move') {
			this.currentSegment = this.hoverSegment;
		}

		if (this.currentSegment)
			this.currentSegment.selected = true;
	},
	mouseup: function(event) {
		if (this.mode == 'close') {
			this.closePath();
		}
		this.mode = null;
	},
	mousedrag: function(event) {
		if (this.mode == 'move' && this.type == 'segment') {
			this.currentSegment.point = this.currentSegment.point.add(event.delta);
		} else {
			if (this.clearHandles) {
				this.currentSegment.handleIn = new Point();
				this.currentSegment.handleOut = new Point();
				this.clearHandles = false;
			}
			var delta = event.delta.clone();
			if (this.type == 'handle-out' || this.mode == 'add' || this.mode == 'close')
				delta = delta.negate();
			this.currentSegment.handleIn = this.currentSegment.handleIn.add(delta);
			this.currentSegment.handleOut = this.currentSegment.handleOut.subtract(delta);
		}
	},
	mousemove: function(event) {
		this.hitTest(event);
	}
});


var toolStack = new Tool();
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
toolStack.setToolMode = function(mode) {
	var event = new paper.Event();
	this.mode = mode;
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
		if (this.hotTool) {
			this.activeTool = this.hotTool;
			this.activeTool.fire('mousedown', event);
		}
	},

	mouseup: function(event) {
		if (this.activeTool)
			this.activeTool.fire('mouseup', event);
		this.activeTool = null;
		this.testHot('mouseup', event);
	},

	mousedrag: function(event) {
		if (this.activeTool)
			this.activeTool.fire('mousedrag', event);
	},

	mousemove: function(event) {
		this.testHot('mousemove', event);
	},

	keydown: function(event) {
		if (this.activeTool)
			this.activeTool.fire('keydown', event);
		else
			this.testHot('keydown', event);
	},

	keyup: function(event) {
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
	Layer.inject({ 
		_selectChildren: false 
	});

	undo = new Undo(20);

	var path1 = new Path.Circle(new Point(180, 50), 30);
	path1.strokeColor = 'black';
	var path2 = new Path.Circle(new Point(180, 150), 20);
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
		if (undo.canUndo())
			undo.undo();
	});
	$("#redo").click(function() {
		if (undo.canRedo())
			undo.redo();
	});

	toolStack.activate();
	toolStack.setToolMode('tool-select');

	paper.view.draw();
});
