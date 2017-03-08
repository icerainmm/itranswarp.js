'use strict';

// attachment api

var
    fs = require('fs'),
    mime = require('mime'),
    api = require('../api'),
    db = require('../db'),
    helper = require('../helper'),
    constants = require('../constants'),
    image = require('../image');

var
    User = db.user,
    Attachment = db.attachment,
    Resource = db.resource,
    warp = db.warp,
    next_id = db.next_id;

function* $getAttachment(id) {
    var atta = yield Attachment.$find(id);
    if (atta === null) {
        throw api.notFound('Attachment');
    }
    return atta;
}

function* $getAttachments(page) {
    page.total = yield Attachment.$findNumber('count(id)');
    if (page.isEmpty) {
        return [];
    }
    return yield Attachment.$findAll({
        offset: page.offset,
        limit: page.limit,
        order: 'created_at desc'
    });
}

// create function(callback) with Attachment object returned in callback:
function* $createAttachment(user_id, name, description, buffer, mime, expectedImage) {
    var
        att_id = next_id(),
        res_id = next_id(),
        imageInfo = null;
    try {
        imageInfo = await image.getImageInfo(buffer);
    }
    catch (e) {
        // not an image
        console.log('attachment data is not an image.');
    }
    if (imageInfo !== null) {
        if (['png', 'jpeg', 'gif'].indexOf(imageInfo.format) !== (-1)) {
            mime = 'image/' + imageInfo.format;
        }
        else {
            imageInfo = null;
        }
    }
    if (imageInfo === null && expectedImage) {
        throw api.invalidParam('image');
    }
    yield Resource.$create({
        id: res_id,
        ref_id: att_id,
        value: buffer
    });
    return yield Attachment.$create({
        id: att_id,
        resource_id: res_id,
        user_id: user_id,
        size: buffer.length,
        mime: mime,
        meta: '',
        width: imageInfo === null ? 0 : imageInfo.width,
        height: imageInfo === null ? 0 : imageInfo.height,
        name: name,
        description: description
    });
}

async function downloadAttachment(ctx, next) {
    let
        id = ctx.request.params.id,
        size = ctx.request.params.size || '0';
    if ('0sml'.indexOf(size) === (-1)) {
        ctx.response.status = 404;
        return;
    }
    var
        atta = await getAttachment(id),
        mime = atta.mime,
        resource = await Resource.findById(atta.resource_id),
        data, origin_width, origin_height, target_width, resize;
    if (resource === null) {
        logger.error('could not find resource by id: ' + atta.resource_id);
        ctx.response.status = 500;
        return;
    }
    data = resource.value;
    if (size !== '0') {
        origin_width = atta.width;
        origin_height = atta.height;
        target_width = origin_width;
        resize = false;
        if (size === 's') {
            // generate small image: 160 x N
            if (origin_width > 160) {
                target_width = 160;
                resize = true;
            }
        } else if (size === 'm') {
            // generate medium image: 320 x N
            if (origin_width > 320) {
                target_width = 320;
                resize = true;
            }
        } else if (size === 'l') {
            // generate large image: 640 x N
            if (origin_width > 640) {
                target_width = 640;
                resize = true;
            }
        }
        if (resize) {
            data = await image.resizeKeepAspect(data, origin_width, origin_height, target_width, 0);
        }
    }
    ctx.response.type = resize ? 'image/jpeg' : mime;
    ctx.response.body = data;
}

module.exports = {

    $getAttachment: $getAttachment,

    $getAttachments: $getAttachments,

    $createAttachment: $createAttachment,

    'GET /files/attachments/:id': downloadAttachment,

    'GET /files/attachments/:id/:size': downloadAttachment,

    'GET /api/attachments/:id': async (ctx, next) =>
        /**
         * Get attachment.
         * 
         * @name Get Attachment
         * @param {string} id: Id of the attachment.
         * @return {object} Attachment object.
         * @error {resource:notfound} Attachment was not found by id.
         */
        this.body = await getAttachment(id);
    },

    'GET /api/attachments': async (ctx, next) => {
        /**
         * Get attachments by page.
         * 
         * @name Get Attachments
         * @param {number} [page=1]: The page number, starts from 1.
         * @return {object} Attachment objects and page information.
         */
        var
            page = helper.getPage(this.request),
            attachments = await getAttachments(page);
        this.body = {
            page: page,
            attachments: attachments
        };
    },

    'POST /api/attachments/:id/delete': async (ctx, next) =>
        /**
         * Delete an attachment by its id.
         * 
         * @name Delete Attachment
         * @param {string} id: The id of the attachment.
         * @return {object} Object contains deleted id.
         * @error {resource:notfound} Attachment was not found by id.
         * @error {permission:denied} If current user has no permission.
         */
        ctx.checkPermission(constants.role.CONTRIBUTOR);
        var
            atta = await getAttachment(id);
        if (this.request.user.role !== constants.role.ADMIN && this.request.user.id !== atta.user_id) {
            throw api.notAllowed('Permission denied.');
        }
        // delete:
        yield atta.$destroy();
        // delete all resources:
        yield warp.$update('delete from resources where ref_id=?', [id]);
        this.body = {
            id: id
        };
    },

    'POST /api/attachments': async (ctx, next) => {
        /**
         * Create a new attachment.
         * 
         * @name Create Attachment
         * @param {string} [name]: Name of the attachment, default to filename.
         * @param {string} [mime=null]: Mime of the attachment, e.g. "application/pdf", all lowercase.
         * @param {string} [description]: Description of the attachment, default to ''.
         * @param {data} data: File data as base64.
         * @return {object} The created attachment object.
         * @error {permission:denied} If current user has no permission.
         */
        ctx.checkPermission(constants.role.CONTRIBUTOR);
        ctx.validate('createAttachment');
        var
            buffer,
            data = this.request.body;
        buffer = new Buffer(data.data, 'base64');
        this.body = await createAttachment(
            this.request.user.id,
            data.name.trim(),
            data.description.trim(),
            buffer,
            data.mime || 'application/octet-stream',
            false
        );
    }
};
