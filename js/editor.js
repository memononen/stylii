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


function setCanvasCursor(name) {
	$("#canvas").removeClass (function (index, css) {
	    return (css.match (/\bcursor-\S+/g) || []).join(' ');
	}).addClass(name);
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
toolSelect.direct = false;
toolSelect.mouseStartPos = new Point();
toolSelect.mode = null;
toolSelect.hitItem = null;
toolSelect.selectionBounds = null;
toolSelect.boundsShape = null;
toolSelect.scale = {
	pivot: null,
	corner: null,
	size: null,
	originalXform: null,
};

toolSelect.resetHot = function(type, event, mode) {
};
toolSelect.testHot = function(type, event, mode) {
	var hot = false;
	if (mode == 'tool-select' || mode == 'tool-direct-select') {
		hot = true;
	}

	if (type == 'mode') {
		if (mode == 'tool-select') {
			this.updateSelectionBounds();
		} else {
			this.clearSelectionBounds();
		}
	}

	if (hot) {
		if (mode == 'tool-select') {
			toolSelect.direct = false;
		} else {
			toolSelect.direct = true;
		}
		this.hitTest(event);
		return true;
	}
	return false;
};


toolSelect.hitTest = function(event) {
	var hitSize = 4.0 / paper.view.zoom;

	// Hit test items.
	this.hitItem = paper.project.hitTest(event.point, { fill:true, stroke:true, tolerance: hitSize });

	if (toolSelect.direct) {
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
	} else {
		// Hit test selection rectangle
		if (this.boundsShape) {
			var hit = this.boundsShape.hitTest(event.point, { bounds: true, guides: true, tolerance: hitSize });
			if (hit) {
				this.hitItem = hit;
			}
		}
	}

	if (this.hitItem) {
		if (this.hitItem.type == 'bounds') {
			// Normalize the direction so that corners are at 45° angles.
			var dir = event.point.subtract(this.selectionBounds.center);
			dir.x /= this.selectionBounds.width*0.5;
			dir.y /= this.selectionBounds.height*0.5;
			setCanvasScaleCursor(dir);
		} else if (this.hitItem.type == 'fill' || this.hitItem.type == 'stroke') {
			if (this.hitItem.item.selected) {
				setCanvasCursor('cursor-arrow-small');
			} else {
				if (this.direct)
					setCanvasCursor('cursor-arrow-white-shape');
				else
					setCanvasCursor('cursor-arrow-black-shape');
			}
		} else if (this.hitItem.type == 'segment' || this.hitItem.type == 'handle-in' || this.hitItem.type == 'handle-out') {
			if (this.hitItem.segment.selected) {
				setCanvasCursor('cursor-arrow-small-point');
			} else {
				if (this.direct)
					setCanvasCursor('cursor-arrow-white-point');
				else
					setCanvasCursor('cursor-arrow-black-point');
			}
		}
	} else {
		if (toolSelect.direct)
			setCanvasCursor('cursor-arrow-white');
		else
			setCanvasCursor('cursor-arrow-black');
	}
};

toolSelect.captureSelectionState = function() {
	this.scale.originalContent = {};
	var selected = paper.project.selectedItems;
	for (var i = 0; i < selected.length; i++) {
		var item = selected[i];
		if (item.guide) continue;
//		this.scale.originalContent[item.id] = item.exportJSON();
		this.scale.originalContent[item.id] = Base.serialize(item);
	}
};
toolSelect.restoreSelectionState = function() {
	var selected = paper.project.selectedItems;
	for (var i = 0; i < selected.length; i++) {
		var item = selected[i];
		if (item.guide) continue;
		if (this.scale.originalContent.hasOwnProperty(item.id)) {
			var id = item.id;
			var json = this.scale.originalContent[item.id];
			item.importJSON(json);
			item._id = id;
		}
	}
};
toolSelect.clearSelectionBounds = function() {
	if (this.boundsShape)
		this.boundsShape.remove();
	this.selectionBounds = null;
	this.boundsShape = null;
};
toolSelect.updateSelectionBounds = function() {
	this.clearSelectionBounds();
	this.selectionBounds = getSelectionBounds();
	if (this.selectionBounds != null) {
		var rect =  new Path.Rectangle(this.selectionBounds);
		//var color = paper.project.activeLayer.getSelectedColor();
		rect.strokeColor = 'rgba(0,0,0,0)'; //color ? color : '#009dec';
		rect.strokeWidth = 1.0 / paper.view.zoom;
		rect._boundsSelected = true;
		rect.selected = true;
		rect.guide = true;
//		rect.transformContent = false;
		this.boundsShape = rect;
	}
};
toolSelect.on({
	activate: function() {
		$("#tools").children().removeClass("selected");
		if (this.direct) {
			$("#tool-direct-select").addClass("selected");
			setCanvasCursor('cursor-arrow-white');
			this.clearSelectionBounds();
		} else {
			$("#tool-select").addClass("selected");
			setCanvasCursor('cursor-arrow-black');
			this.updateSelectionBounds();
		}
		this.hitItem = null;
	},
	deactivate: function() {
		this.clearSelectionBounds();
	},
	mousedown: function(event) {
		this.mode = null;

		if (this.hitItem) {
			if (this.hitItem.type == 'bounds') {
				this.captureSelectionState();
				this.mode = 'scale';
				var pivotName = paper.Base.camelize(oppositeCorner[this.hitItem.name]);
				var cornerName = paper.Base.camelize(this.hitItem.name);
				this.scale.pivot = this.selectionBounds[pivotName].clone();
				this.scale.corner = this.selectionBounds[cornerName].clone();
				this.scale.size = this.scale.corner.subtract(this.scale.pivot);
			} else if (this.hitItem.type == 'fill' || this.hitItem.type == 'stroke') {
				if (event.modifiers.shift) {
					this.hitItem.item.selected = !this.hitItem.item.selected;
				} else {
					if (!this.hitItem.item.selected)
						paper.project.activeLayer.selected = false;
					this.hitItem.item.selected = true;
				}
				if (this.hitItem.item.selected) {
					this.mode = 'move-shapes';
					deselectAllPoints();
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
				}
			} else if (this.hitItem.type == 'handle-in' || this.hitItem.type == 'handle-out') {
				this.mode = 'move-handle';
			}
			if (!this.direct)
				this.updateSelectionBounds();
		} else {
			// Clicked on and empty area, engage box select.
			this.mouseStartPos = event.point.clone();
			this.mode = 'box-select';
		}

	},
	mouseup: function(event) {
		if (this.mode == 'box-select') {
			var box = new Rectangle(this.mouseStartPos, event.point);

			if (!event.modifiers.shift)
				paper.project.activeLayer.selected = false;

			var selectedSegments = [];
			if (toolSelect.direct)
				selectedSegments = getSegmentsInRect(box);

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

		if (!this.direct)
			this.updateSelectionBounds();

		if (this.hitItem) {
			if (this.hitItem.item.selected) {
				setCanvasCursor('cursor-arrow-small');
			} else {
				if (this.direct)
					setCanvasCursor('cursor-arrow-white-shape');
				else
					setCanvasCursor('cursor-arrow-black-shape');
			}
		}
	},
	mousedrag: function(event) {
		if (this.mode == 'move-shapes') {
			setCanvasCursor('cursor-arrow-small');
			var selected = paper.project.selectedItems;
			for (var i = 0; i < selected.length; i++) {
				selected[i].position = selected[i].position.add(event.delta);
			}
		} else if (this.mode == 'move-points') {
			setCanvasCursor('cursor-arrow-small');
			var selected = paper.project.selectedItems;
			for (var i = 0; i < selected.length; i++) {
				var path = selected[i];
				for (var j = 0; j < path.segments.length; j++) {
					if (path.segments[j].selected)
						path.segments[j].point = path.segments[j].point.add(event.delta);
				}
			}
		} else if (this.mode == 'move-handle') {
			var delta = event.delta.clone();
			if (this.hitItem.type == 'handle-out')
				delta = delta.negate();
			this.hitItem.segment.handleIn = this.hitItem.segment.handleIn.add(delta);
			this.hitItem.segment.handleOut = this.hitItem.segment.handleOut.subtract(delta);
		} else if (this.mode == 'box-select') {
			dragRect(this.mouseStartPos, event.point);
		} else if (this.mode == 'scale') {

			this.scale.corner = this.scale.corner.add(event.delta);
			var size = this.scale.corner.subtract(this.scale.pivot);
			var sx = 1.0, sy = 1.0;
			if (Math.abs(this.scale.size.x) > 0.0000001)
				sx = size.x / this.scale.size.x;
			if (Math.abs(this.scale.size.y) > 0.0000001)
				sy = size.y / this.scale.size.y;

			this.restoreSelectionState();

			var selected = paper.project.selectedItems;
			for (var i = 0; i < selected.length; i++) {
				var item = selected[i];
				if (item.guide) continue; 
				item.scale(sx, sy, this.scale.pivot);
			}
			this.updateSelectionBounds();
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
	var hot = false;
	if (mode == 'tool-zoompan')
		hot = true;
	// Choose tool when space is pressed.
	if (event && event.modifiers.space)
		hot = true;
	if (hot) {
		this.previewCursor(event);
		return true;
	}
	return false;
};
toolZoomPan.previewCursor = function(event) {
	if (event.modifiers.command) {
		if (event.modifiers.command && !event.modifiers.option) {
			setCanvasCursor('cursor-zoom-in');
		} else if (event.modifiers.command && event.modifiers.option) {
			setCanvasCursor('cursor-zoom-out');
		}
	} else {
		setCanvasCursor('cursor-hand');
	}
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
		this.previewCursor(event);
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
		this.previewCursor(event);
	},

	keydown: function(event) {
		this.previewCursor(event);
	},

	keyup: function(event) {
		this.previewCursor(event);
	}
});

var toolPen = new Tool();
toolPen.path = null;
toolPen.clearHandles = false;
toolPen.hoverSegment = null;
toolPen.currentSegment = null;
toolPen.resetHot = function(type, event, mode) {
};
toolPen.testHot = function(type, event, mode) {
	var hot = false;
	if (mode == 'tool-pen')
		hot = true;

	if (hot) {
		this.hitTest(event);
		return true;
	}
	return false;
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
		}
	} else {
		setCanvasCursor('cursor-pen-add');
	}
};
toolPen.on({
	activate: function() {
		$("#tools").children().removeClass("selected");
		$("#tool-pen").addClass("selected");
		this.mode = this.type = this.currentSegment = null;
		setCanvasCursor('cursor-pen-add');
	},
	deactivate: function() {
		if (toolPen.path)
			toolPen.path = null;
	},
	mousedown: function(event) {
		if (this.currentSegment)
			this.currentSegment.selected = false;

		if (this.mode == 'add') {
			if (!this.path) {
				paper.project.activeLayer.selected = false;
				this.path = new Path();
				this.path.strokeColor = 'black';
//				this.path.transformContent = false;
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
			deselectAllPoints();
			this.path = null;
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

	var path1 = new Path.Circle(new Point(180, 50), 30);
	path1.strokeColor = 'black';
//	path1.transformContent = false;
	var path2 = new Path.Circle(new Point(180, 150), 20);
	path2.fillColor = 'grey';
//	path2.transformContent = false;

	$("#tool-select").click(function() {
		toolStack.setToolMode('tool-select');
//		toolSelect.direct = false;
//		toolSelect.activate();
	});
	$("#tool-direct-select").click(function() {
		toolStack.setToolMode('tool-direct-select');
//		toolSelect.direct = true;
//		toolSelect.activate();
	});
	$("#tool-pen").click(function() {
		toolStack.setToolMode('tool-pen');
//		toolPen.activate();
	});
	$("#tool-zoompan").click(function() {
		toolStack.setToolMode('tool-zoompan');
//		toolZoomPan.activate();
	});

	toolStack.activate();
	toolStack.setToolMode('tool-select');
//	toolSelect.activate();

	paper.view.draw();
});
