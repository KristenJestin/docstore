using AutoMapper;
using Docstore.App.Common.Extendeds;
using Docstore.App.Common.Extensions;
using Docstore.App.Models;
using Docstore.App.Models.Abstracts;
using Docstore.App.Models.Forms;
using Docstore.Application.Common;
using Docstore.Application.Extensions;
using Docstore.Application.Interfaces;
using Docstore.Application.Models;
using Docstore.Application.Models.DTO;
using Docstore.Domain.Entities;
using Docstore.Domain.Extensions;
using Docstore.Persistence.Contexts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Docstore.App.Controllers
{
    [Authorize]
    public class DocumentsController : ExtendedController
    {
        private const int PAGE_SIZE = 6;

        private readonly IMapper _mapper;
        private readonly ApplicationDbContext _db;
        private readonly IWebHostEnvironment _hostingEnvironment;
        private readonly AppSettings _appSettings;
        private readonly IDocumentRepository _documentRepository;
        private readonly IFolderRepository _folderRepository;
        private readonly IDocumentFileRepository _documentFileRepository;

        public DocumentsController(ApplicationDbContext db, IMapper mapper, IWebHostEnvironment hostingEnvironment, IOptions<AppSettings> appSettings, IDocumentRepository documentRepository, IFolderRepository folderRepository, IDocumentFileRepository documentFileRepository)
        {
            _db = db;
            _mapper = mapper;
            _hostingEnvironment = hostingEnvironment;
            _appSettings = appSettings.Value;
            _documentRepository = documentRepository;
            _folderRepository = folderRepository;
            _documentFileRepository = documentFileRepository;
        }


        #region actions
        public async Task<IActionResult> Index(int? page = 1, int? folderId = null, int? tagId = null)
        {
            // get data
            var documents = await _documentRepository.GetPagedReponseAsync(UserId, page ?? 1, PAGE_SIZE, tag: tagId, folder: folderId);

            Folder? folder = null;
            if (folderId != null)
                folder = await _folderRepository.FindByIdAsync(UserId, folderId.Value);

            // response
            var viewModel = new DocumentsIndexViewModel
            {
                Documents = documents,
                FolderId = folderId,
                Folder = folder
            };
            return View(viewModel);
        }

        public async Task<IActionResult> Create(int? folderId = null)
        {
            // data
            Folder? folder = null;

            if (folderId != null)
                folder = await _folderRepository.FindByIdAsync(UserId, folderId.Value);

            // response
            var viewModel = new DocumentCreateViewModel(folderId, folder);
            return View(viewModel);
        }

        [HttpPost]
        public async Task<IActionResult> Create(DocumentForm? form)
        {
            // model validation
            try
            {
                if (ModelState.IsValid && form != null)
                {
                    var documentFiles = await _documentFileRepository.FindByIdsAsync(UserId, form.Files.ToArray());

                    // transform to database entity
                    var document = _mapper.Map<Document>(form);
                    document.Tags = await form.CreateNewTagsAndGetListAsync(_db, UserId);
                    document.Files = documentFiles.ToList();
                    document.UserId = UserId;

                    foreach (var (item, index) in document.Files.WithIndex())
                        item.Order = index;

                    // save in database
                    await _documentRepository.AddAsync(document, save: true);

                    // response
                    return RedirectToAction(nameof(Index))
                        .AddToast(TempData, ToastType.Success, $"\"{document.Name}\" successfuly created!");
                }
            }
            catch (Exception ex)
            {
                ModelState.AddModelError("", "An unexpected error occurred.");
            }

            // pick folder if it selected
            Folder? folder = null;
            if (form?.FolderId != null)
                folder = await _folderRepository.FindByIdAsync(UserId, form.FolderId.Value);

            IEnumerable<GetDocumentFileDto> files = new List<GetDocumentFileDto>();
            if (form?.Files != null && form.Files.Any())
            {
                var documentFiles = await _documentFileRepository.FindByIdsAsync(UserId, form.Files.ToArray());
                files = _mapper.Map<IEnumerable<GetDocumentFileDto>>(documentFiles);
            }

            // response
            var viewModel = new DocumentCreateViewModel(folder?.Id, folder, files)
            {
                Form = form ?? DocumentFormViewModel.GetDefaultFormValues()
            };
            return View(viewModel);
        }


        public async Task<IActionResult> Show(int id)
        {
            var document = await _documentRepository.FindByIdWithTypeAndTagsAndFileAsync(UserId, id);

            if (document == null)
                return NotFound();

            // response
            var viewModel = new DocumentShowViewModel(document);
            return View(viewModel);
        }

        [HttpGet("{controller}/" + nameof(Show) + "/{id:int}/{action}/{fileId:int}")]
        public async Task<IActionResult> Download(int id, int fileId)
        {
            var userDocument = await _documentRepository.FindByIdAsync(UserId, id);

            if (userDocument == null)
                return NotFound();

            var file = await _documentFileRepository.FindByIdAsync(UserId, fileId);

            if (file == null || userDocument.Id != file.DocumentId)
                return NotFound();

            // response
            var filePath = file.GetFilePath(_hostingEnvironment.WebRootPath);
            return File(await Encryption.DecryptWithMemoryAsync(filePath, _appSettings.AppKey!), file.MimeType!, file.GetFileName(), true);
        }

        public async Task<IActionResult> Edit(int id)
        {
            // check if exist
            var document = await _documentRepository.FindByIdAsync(UserId, id);
            if (document == null)
                return RedirectToAction(nameof(Index))
                    .AddToast(TempData, ToastType.Error, "This document does not exist.");

            return await EditDefault(document);
        }

        [HttpPost]
        public async Task<IActionResult> Edit(int id, DocumentForm? form)
        {
            var document = await _documentRepository.FindByIdAsync(UserId, id);

            if (document == null)
                return NotFound();

            // model validation
            try
            {
                if (ModelState.IsValid && form != null)
                {
                    var documentFiles = await _documentFileRepository.FindByIdsAsync(UserId, form.Files.ToArray());

                    // copie new data in entity
                    _mapper.Map(form, document);

                    document.Tags = await form.CreateNewTagsAndGetListAsync(_db, UserId);
                    document.Files = documentFiles.ToList();

                    // save in database
                    await _documentRepository.UpdateAsync(document, save: true);

                    // response
                    return RedirectToAction(nameof(Index))
                        .AddToast(TempData, ToastType.Success, $"\"{document.Name}\" successfuly updated!");
                }
            }
            catch (Exception ex)
            {
                ModelState.AddModelError("", "An unexpected error occurred.");
            }

            return await EditDefault(document);
        }
        #endregion

        #region privates
        private async Task<IActionResult> EditDefault(Document document)
        {
            // data
            var form = _mapper.Map<DocumentForm>(document);
            form.Tags = document.Tags.Select(x => x.Name!);
            var files = _mapper.Map<IEnumerable<GetDocumentFileDto>>(document.Files);

            // response
            var viewModel = new DocumentEditViewModel(document.FolderId, document.Folder, files)
            {
                Form = form
            };
            return View(viewModel);
        }
        #endregion
    }
}
